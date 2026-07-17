use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::thread;
use tauri::{AppHandle, Manager};

pub struct ExiftoolProcess {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    binary: PathBuf,
    config: Option<PathBuf>,
}

// Resources declared in tauri.conf.json under `resources/<name>` are staged at
// `<resource_dir>/resources/<name>` — the `resources/` path component is preserved
// and must be included when resolving them at runtime. Omitting it (joining
// `<resource_dir>/exiftool` directly) silently fails on any machine without a
// system exiftool on the fallback path, which is exactly how a broken bundle
// shipped undetected: the developer's Homebrew exiftool masked the missing file.
fn bundled_exiftool_path(resource_dir: &std::path::Path) -> PathBuf {
    resource_dir.join("resources").join("exiftool")
}

fn bundled_exiftool_config_path(resource_dir: &std::path::Path) -> PathBuf {
    resource_dir.join("resources").join("exiftool.config")
}

impl ExiftoolProcess {
    pub fn binary_path(app_handle: &AppHandle) -> PathBuf {
        if let Ok(res_dir) = app_handle.path().resource_dir() {
            let bundled = bundled_exiftool_path(&res_dir);
            if bundled.exists() {
                return bundled;
            }
        }
        for path in ["/opt/homebrew/bin/exiftool", "/usr/local/bin/exiftool"] {
            if std::path::Path::new(path).exists() {
                return PathBuf::from(path);
            }
        }
        PathBuf::from("exiftool")
    }

    pub fn start(app_handle: &AppHandle) -> Result<Self, String> {
        let binary = Self::binary_path(app_handle);
        let config = app_handle
            .path()
            .resource_dir()
            .ok()
            .map(|d| bundled_exiftool_config_path(&d))
            .filter(|p| p.exists());
        Self::start_with_binary(binary, config)
    }

    /// Build a Command that runs the exiftool script. On macOS the script is passed
    /// as an argument to the system perl rather than exec'd directly: exiftool is an
    /// unsigned perl script, and exec'ing it from a freshly downloaded (quarantined)
    /// app bundle fails Gatekeeper's exec-time check with EPERM. /usr/bin/perl is an
    /// Apple platform binary, and a script it merely reads is not subject to that
    /// check. This also removes the dependency on the `#!/usr/bin/env perl` shebang
    /// resolving through the minimal PATH of Finder-launched apps.
    fn command_for(script: &std::path::Path) -> Command {
        #[cfg(target_os = "macos")]
        {
            let perl = std::path::Path::new("/usr/bin/perl");
            if perl.exists() {
                let mut cmd = Command::new(perl);
                cmd.arg(script);
                return cmd;
            }
        }
        Command::new(script)
    }

    pub fn start_with_binary(binary: PathBuf, config: Option<PathBuf>) -> Result<Self, String> {
        // -config must be the very first exiftool argument; it cannot be passed
        // per-command in -stay_open mode.
        let mut cmd = Self::command_for(&binary);
        if let Some(ref cfg) = config {
            cmd.arg("-config").arg(cfg);
        }
        let mut child = cmd
            .args(["-stay_open", "True", "-@", "/dev/stdin"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("failed to start exiftool at {}: {}", binary.display(), e))?;

        let stdin = child.stdin.take().ok_or("exiftool: no stdin handle")?;
        let stdout = BufReader::new(child.stdout.take().ok_or("exiftool: no stdout handle")?);

        // Mirror stderr to the console and keep a bounded copy so a startup
        // failure can report what exiftool/perl actually printed.
        let stderr_buf = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
        if let Some(stderr) = child.stderr.take() {
            let buf = std::sync::Arc::clone(&stderr_buf);
            thread::spawn(move || {
                for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                    eprintln!("[exiftool] {}", line);
                    if let Ok(mut b) = buf.lock() {
                        if b.len() < 2000 {
                            b.push_str(&line);
                            b.push('\n');
                        }
                    }
                }
            });
        }

        let mut process = ExiftoolProcess { child, stdin, stdout, binary, config };

        // Health check: a spawn can succeed and the process still die immediately
        // (e.g. the perl module tree missing next to the script). Catch that here
        // so the failure surfaces at startup with perl's own error message rather
        // than as a cryptic failure on first use.
        match process.run_command(&["-ver"]) {
            Ok(_) => Ok(process),
            Err(e) => {
                thread::sleep(std::time::Duration::from_millis(100));
                let stderr_text = stderr_buf.lock().map(|b| b.clone()).unwrap_or_default();
                if stderr_text.is_empty() {
                    Err(format!("exiftool failed startup check: {e}"))
                } else {
                    Err(format!("exiftool failed startup check: {e}\n{stderr_text}"))
                }
            }
        }
    }

    /// Run a command and return stdout text. Each element of `args` is one CLI argument.
    pub fn run_command(&mut self, args: &[&str]) -> Result<String, String> {
        for arg in args {
            writeln!(self.stdin, "{}", arg)
                .map_err(|e| format!("exiftool stdin write: {}", e))?;
        }
        writeln!(self.stdin, "-execute")
            .map_err(|e| format!("exiftool stdin write: {}", e))?;
        self.stdin
            .flush()
            .map_err(|e| format!("exiftool stdin flush: {}", e))?;

        let mut output = String::new();
        let mut line = String::new();
        loop {
            line.clear();
            let n = self
                .stdout
                .read_line(&mut line)
                .map_err(|e| format!("exiftool stdout read: {}", e))?;
            if n == 0 {
                return Err("exiftool exited unexpectedly".to_string());
            }
            if line.trim_end() == "{ready}" {
                break;
            }
            output.push_str(&line);
        }
        Ok(output)
    }

    /// Extract the largest embedded JPEG preview from `file_path` and write it to `output_path`.
    /// Returns true if a preview was written, false if none found.
    ///
    /// Runs as a one-shot subprocess (not through the stay_open pipe) because exiftool
    /// writes binary preview data directly to stdout for some RAW formats (e.g. CR3) even
    /// when -o= is specified, which would corrupt the stay_open stdout stream.
    pub fn extract_preview(
        &self,
        file_path: &std::path::Path,
        output_path: &std::path::Path,
    ) -> Result<bool, String> {
        let file_str = file_path.to_string_lossy();

        for tag in &["-PreviewImage", "-JpgFromRaw"] {
            // Remove any leftover file from a previous attempt.
            let _ = std::fs::remove_file(output_path);

            let out_file = std::fs::File::create(output_path)
                .map_err(|e| format!("exiftool preview create file: {}", e))?;

            let mut cmd = Self::command_for(&self.binary);
            if let Some(ref cfg) = self.config {
                cmd.arg("-config").arg(cfg);
            }
            cmd.args(["-b", tag, &file_str])
                .stdout(Stdio::from(out_file))
                .stderr(Stdio::null());

            cmd.status()
                .map_err(|e| format!("exiftool preview spawn: {}", e))?;

            if output_path.metadata().map(|m| m.len() > 0).unwrap_or(false) {
                return Ok(true);
            }
        }

        Ok(false)
    }

    /// Read JSON metadata from `file_path`.
    pub fn read_metadata(
        &mut self,
        file_path: &std::path::Path,
    ) -> Result<serde_json::Value, String> {
        let file_str = file_path.to_string_lossy();
        let output = self.run_command(&[
            "-json",
            "-coordFormat",
            "%.6f",
            "-DateTimeOriginal",
            "-OffsetTimeOriginal",
            "-GPSLatitude",
            "-GPSLatitudeRef",
            "-GPSLongitude",
            "-GPSLongitudeRef",
            "-Make",
            "-Model",
            "-LensModel",
            "-XMP:DateTimeOriginal",
            "-XMP:FilmStock",
            "-XMP:Film",
            "-IPTC:Keywords",
            "-XMP:Subject",
            &file_str,
        ])?;

        let arr: serde_json::Value = serde_json::from_str(output.trim())
            .map_err(|e| format!("exiftool json parse: {}", e))?;
        arr.as_array()
            .and_then(|a| a.first())
            .cloned()
            .ok_or_else(|| "exiftool returned empty JSON array".to_string())
    }

    /// Read metadata from `raw_path` and merge in XMP tags from `xmp_path`.
    /// XMP sidecar values win for any overlapping keys (non-null values only).
    pub fn read_metadata_with_sidecar(
        &mut self,
        raw_path: &std::path::Path,
        xmp_path: &std::path::Path,
    ) -> Result<serde_json::Value, String> {
        let mut raw_json = self.read_metadata(raw_path)?;
        let xmp_json = self.read_metadata(xmp_path)?;
        if let (Some(raw_obj), Some(xmp_obj)) = (raw_json.as_object_mut(), xmp_json.as_object()) {
            for (k, v) in xmp_obj {
                if !v.is_null() {
                    raw_obj.insert(k.clone(), v.clone());
                }
            }
        }
        Ok(raw_json)
    }

    /// Read the numeric EXIF Orientation tag (1–8). Returns 1 (normal) if absent or unreadable.
    pub fn read_orientation(&mut self, file_path: &std::path::Path) -> Result<u32, String> {
        let file_str = file_path.to_string_lossy();
        let output = self.run_command(&["-json", "-Orientation#", &file_str])?;
        let arr: serde_json::Value = serde_json::from_str(output.trim())
            .map_err(|e| format!("exiftool orientation json parse: {}", e))?;
        Ok(arr
            .as_array()
            .and_then(|a| a.first())
            .and_then(|o| o.get("Orientation"))
            .and_then(|v| v.as_u64())
            .unwrap_or(1) as u32)
    }

    pub fn stop(&mut self) {
        let _ = writeln!(self.stdin, "-stay_open\nFalse");
        let _ = self.stdin.flush();
        let _ = self.child.wait();
    }
}

impl Drop for ExiftoolProcess {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn find_exiftool() -> Option<PathBuf> {
        for path in ["/opt/homebrew/bin/exiftool", "/usr/local/bin/exiftool"] {
            if std::path::Path::new(path).exists() {
                return Some(PathBuf::from(path));
            }
        }
        None
    }

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("test-fixtures")
            .join(name)
    }

    fn start() -> ExiftoolProcess {
        let binary = find_exiftool().expect("exiftool not found");
        ExiftoolProcess::start_with_binary(binary, None).expect("failed to start exiftool")
    }

    // ── bundled path resolution ──────────────────────────────────────────────

    #[test]
    fn bundled_paths_include_resources_subdir() {
        // Tauri stages `resources/exiftool` at <resource_dir>/resources/exiftool.
        let res_dir = PathBuf::from("/Apps/Backstamp.app/Contents/Resources");
        assert_eq!(
            bundled_exiftool_path(&res_dir),
            PathBuf::from("/Apps/Backstamp.app/Contents/Resources/resources/exiftool")
        );
        assert_eq!(
            bundled_exiftool_config_path(&res_dir),
            PathBuf::from("/Apps/Backstamp.app/Contents/Resources/resources/exiftool.config")
        );
    }

    #[test]
    fn bundled_exiftool_resolves_in_simulated_bundle() {
        // Lay out a fake bundle exactly as tauri stages it, and confirm the helper
        // points at the real file (not <resource_dir>/exiftool, which would miss).
        let dir = TempDir::new().unwrap();
        let res_dir = dir.path();
        std::fs::create_dir_all(res_dir.join("resources")).unwrap();
        std::fs::write(res_dir.join("resources").join("exiftool"), b"#!/usr/bin/perl\n").unwrap();

        let resolved = bundled_exiftool_path(res_dir);
        assert!(resolved.exists(), "resolved bundled path should exist: {:?}", resolved);
        assert!(!res_dir.join("exiftool").exists(), "flat path must not be where the file is");
    }

    // ── extract_preview ──────────────────────────────────────────────────────

    #[test]
    fn extract_preview_cr3_returns_true_and_writes_jpeg() {
        let dir = TempDir::new().unwrap();
        let out = dir.path().join("preview.jpg");
        let et = start();

        let found = et.extract_preview(&fixture("3S1A1308.CR3"), &out).unwrap();

        assert!(found, "expected a preview to be found in CR3");
        assert!(out.exists(), "output file was not created");
        assert!(out.metadata().unwrap().len() > 0, "output file is empty");
        // Verify it starts with JPEG magic bytes
        let bytes = std::fs::read(&out).unwrap();
        assert_eq!(&bytes[..2], b"\xff\xd8", "output is not a JPEG");
    }

    #[test]
    fn extract_preview_returns_false_when_no_preview_embedded() {
        // These fixtures are flatbed-scanner TIFFs with no embedded JPEG preview.
        let dir = TempDir::new().unwrap();
        let out = dir.path().join("preview.jpg");
        let et = start();

        let found = et.extract_preview(&fixture("Image (223).tif"), &out).unwrap();

        assert!(!found, "expected no preview in a scanner TIFF");
    }

    // ── read_metadata ────────────────────────────────────────────────────────

    #[test]
    fn read_metadata_cr3_returns_make_and_model() {
        let mut et = start();
        let meta = et.read_metadata(&fixture("3S1A1308.CR3")).unwrap();
        assert!(meta.get("Make").is_some(), "Make tag missing from CR3 metadata");
        assert!(meta.get("Model").is_some(), "Model tag missing from CR3 metadata");
    }

    #[test]
    fn read_metadata_cr3_does_not_corrupt_subsequent_commands() {
        // Ensures binary data in CR3 doesn't leave garbage in the stay_open pipe.
        let mut et = start();
        et.read_metadata(&fixture("3S1A1308.CR3")).unwrap();
        // A second read on a different file must also succeed.
        let meta = et.read_metadata(&fixture("3S1A1324.CR3")).unwrap();
        assert!(meta.get("Make").is_some());
    }

    #[test]
    fn read_metadata_with_sidecar_merges_xmp_values() {
        let mut et = start();
        let meta = et
            .read_metadata_with_sidecar(&fixture("3S1A1308.CR3"), &fixture("3S1A1308.xmp"))
            .unwrap();
        // The sidecar's DateTimeOriginal is ISO 8601 with sub-seconds and offset
        // ("2026:02:09 21:39:03.61-08:00"), which is more precise than the EXIF
        // value ("2026:02:09 21:39:03") and should win after the merge.
        let dt = meta["DateTimeOriginal"].as_str().unwrap_or("");
        assert!(
            dt.contains('T') || dt.contains('.') || dt.contains('-'),
            "expected sidecar DateTimeOriginal to override EXIF value, got: {}",
            dt
        );
    }
}
