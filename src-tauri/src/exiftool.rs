use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use tauri::{AppHandle, Manager};

pub struct ExiftoolProcess {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl ExiftoolProcess {
    pub fn binary_path(app_handle: &AppHandle) -> PathBuf {
        if let Ok(res_dir) = app_handle.path().resource_dir() {
            let bundled = res_dir.join("exiftool");
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
        let mut child = Command::new(&binary)
            .args(["-stay_open", "True", "-@", "/dev/stdin"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("failed to start exiftool at {}: {}", binary.display(), e))?;

        let stdin = child.stdin.take().ok_or("exiftool: no stdin handle")?;
        let stdout = BufReader::new(child.stdout.take().ok_or("exiftool: no stdout handle")?);
        Ok(ExiftoolProcess { child, stdin, stdout })
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
    pub fn extract_preview(
        &mut self,
        file_path: &std::path::Path,
        output_path: &std::path::Path,
    ) -> Result<bool, String> {
        let out_str = output_path.to_string_lossy();
        let file_str = file_path.to_string_lossy();

        // Try largest preview first
        self.run_command(&[
            "-b",
            "-PreviewImage",
            &format!("-o={}", out_str),
            &file_str,
        ])?;
        if output_path.exists()
            && output_path
                .metadata()
                .map(|m| m.len() > 0)
                .unwrap_or(false)
        {
            return Ok(true);
        }

        // Fallback: embedded JPEG (used by some RAW formats)
        self.run_command(&[
            "-b",
            "-JpgFromRaw",
            &format!("-o={}", out_str),
            &file_str,
        ])?;
        Ok(output_path.exists()
            && output_path
                .metadata()
                .map(|m| m.len() > 0)
                .unwrap_or(false))
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
