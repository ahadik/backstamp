use crate::exiftool::ExiftoolProcess;
use std::path::{Path, PathBuf};

pub enum WriteTarget {
    Inline(PathBuf),  // JPEG, TIFF, HEIC: atomic temp-file + rename
    Sidecar(PathBuf), // all RAW formats: write to <original>.xmp
}

pub fn write_target(path: &Path) -> WriteTarget {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
    {
        Some(e) if matches!(e.as_str(), "jpg" | "jpeg" | "tif" | "tiff" | "heic") => {
            WriteTarget::Inline(path.to_path_buf())
        }
        _ => WriteTarget::Sidecar(path.with_extension("xmp")),
    }
}

pub struct FieldWrite {
    pub field: String,
    pub value: Option<String>,
}

pub struct PhotoWrite {
    pub photo_id: String,
    pub file_path: PathBuf,
    pub fields: Vec<FieldWrite>,
    pub utc_offset: Option<String>,
}

/// Assemble ExifTool argument strings for the given fields.
/// Returns (tag_args, capture_date, capture_time, utc_offset) where tag_args are ready-to-use.
pub fn build_exiftool_args(write: &PhotoWrite) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();

    let mut capture_date: Option<&str> = None;
    let mut capture_time: Option<&str> = None;
    let mut has_date_clear = false;
    let mut film_vendor: Option<&str> = None;
    let mut film_type: Option<&str> = None;
    let mut has_film_vendor = false;

    for fw in &write.fields {
        match fw.field.as_str() {
            "capture_date" => {
                capture_date = fw.value.as_deref();
                if fw.value.is_none() {
                    has_date_clear = true;
                }
            }
            "capture_time" => {
                capture_time = fw.value.as_deref();
            }
            "utc_offset" => {
                // handled separately below
            }
            "film_vendor" => {
                film_vendor = fw.value.as_deref();
                has_film_vendor = true;
            }
            "film_type" => {
                film_type = fw.value.as_deref();
            }
            _ => {
                let tag_arg = field_to_exiftool_args(fw);
                args.extend(tag_arg);
            }
        }
    }

    // Combine film_vendor + film_type into a single FilmStock tag.
    if has_film_vendor {
        match film_vendor {
            None => args.push("-XMP-pm:FilmStock=".to_string()),
            Some(vendor) => {
                let stock = match film_type {
                    Some(t) if !t.is_empty() => format!("{} {}", vendor, t),
                    _ => vendor.to_string(),
                };
                args.push(format!("-XMP-pm:FilmStock={}", stock));
            }
        }
    } else if let Some(t) = film_type {
        // film_type changed without film_vendor in this write — keep existing vendor by
        // not touching the tag; this path should not occur in normal usage since
        // handleFilmTypeSelect always includes filmVendor in the change set.
        args.push(format!("-XMP-pm:FilmStock={}", t));
    }

    // Merge captureDate + captureTime → DateTimeOriginal (and sibling date fields)
    if has_date_clear {
        args.push("-DateTimeOriginal=".to_string());
        args.push("-CreateDate=".to_string());
        args.push("-ModifyDate=".to_string());
        args.push("-OffsetTimeOriginal=".to_string());
    } else if let Some(date) = capture_date {
        let time = capture_time.unwrap_or("00:00:00");
        // Convert "YYYY-MM-DD" to "YYYY:MM:DD"
        let exif_date = date.replace('-', ":");
        let dt = format!("{} {}", exif_date, time);
        // Write all three EXIF date fields so viewers that show CreateDate or
        // ModifyDate (which ExifTool otherwise auto-updates to the current time)
        // display the same capture datetime the user specified.
        args.push(format!("-DateTimeOriginal={}", dt));
        args.push(format!("-CreateDate={}", dt));
        args.push(format!("-ModifyDate={}", dt));
        // Sync the file-system modification timestamp so Finder also shows the
        // capture date rather than the time the Apply button was clicked.
        args.push(format!("-FileModifyDate={}", dt));

        if let Some(offset) = &write.utc_offset {
            args.push(format!("-OffsetTimeOriginal={}", offset));
        }
    }

    args
}

fn field_to_exiftool_args(fw: &FieldWrite) -> Vec<String> {
    match fw.field.as_str() {
        "gps_lat" => {
            if let Some(ref v) = fw.value {
                if let Ok(lat) = v.parse::<f64>() {
                    // Pass the *signed* value, not the absolute value. For XMP
                    // sidecars (all RAW formats) ExifTool encodes the hemisphere
                    // from the sign of the coordinate and ignores the separate
                    // -GPSLatitudeRef arg, so a positive value would always be
                    // written as North regardless of Ref. The explicit Ref is
                    // still required for embedded EXIF (JPEG/TIFF/HEIC), where a
                    // signed value alone leaves the Ref field empty. Passing both
                    // is correct for every write target. See issue #21.
                    let r#ref = if lat >= 0.0 { "N" } else { "S" };
                    return vec![
                        format!("-GPSLatitude={}", lat),
                        format!("-GPSLatitudeRef={}", r#ref),
                    ];
                }
            }
            // Clear
            vec![
                "-GPSLatitude=".to_string(),
                "-GPSLatitudeRef=".to_string(),
            ]
        }
        "gps_lng" => {
            if let Some(ref v) = fw.value {
                if let Ok(lng) = v.parse::<f64>() {
                    // Signed value + explicit Ref; see the gps_lat note above and
                    // issue #21. A positive (abs) value was previously written to
                    // XMP sidecars as East even for western-hemisphere photos.
                    let r#ref = if lng >= 0.0 { "E" } else { "W" };
                    return vec![
                        format!("-GPSLongitude={}", lng),
                        format!("-GPSLongitudeRef={}", r#ref),
                    ];
                }
            }
            vec![
                "-GPSLongitude=".to_string(),
                "-GPSLongitudeRef=".to_string(),
            ]
        }
        "camera_make" => match &fw.value {
            Some(v) => vec![format!("-Make={}", v)],
            None => vec!["-Make=".to_string()],
        },
        "camera_model" => match &fw.value {
            Some(v) => vec![format!("-Model={}", v)],
            None => vec!["-Model=".to_string()],
        },
        "lens" => match &fw.value {
            Some(v) => vec![format!("-LensModel={}", v)],
            None => vec!["-LensModel=".to_string()],
        },
        // unknown fields: skip
        _ => vec![],
    }
}

/// Write metadata for a single photo. Returns Ok on success, Err with ExifTool stderr on failure.
pub fn write_metadata(
    exiftool: &mut ExiftoolProcess,
    write: &PhotoWrite,
) -> Result<(), String> {
    if write.fields.is_empty() {
        return Ok(());
    }

    let tag_args = build_exiftool_args(write);
    if tag_args.is_empty() {
        return Ok(());
    }

    match write_target(&write.file_path) {
        WriteTarget::Inline(path) => write_inline(exiftool, &path, &tag_args),
        WriteTarget::Sidecar(sidecar_path) => {
            write_sidecar(exiftool, &write.file_path, &sidecar_path, &tag_args)
        }
    }
}

fn write_inline(
    exiftool: &mut ExiftoolProcess,
    path: &Path,
    tag_args: &[String],
) -> Result<(), String> {
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("photo");
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("jpg");
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    let temp_path = dir.join(format!("{}_pmtmp.{}", stem, ext));
    let temp_str = temp_path.to_string_lossy().into_owned();
    let path_str = path.to_string_lossy().into_owned();

    let mut args: Vec<&str> = Vec::new();

    // -m: treat minor errors (e.g. "Maker notes could not be parsed" on scanner
    // TIFFs) as warnings rather than aborting the write. The unrecognised maker
    // note bytes are still copied verbatim to the output file.
    args.push("-m");
    for a in tag_args {
        args.push(a.as_str());
    }
    args.push("-o");
    args.push(temp_str.as_str());
    args.push(path_str.as_str());

    let result = exiftool.run_command(&args);

    match result {
        Ok(output) => {
            // ExifTool signals errors inline (e.g. "Error: ...")
            if output.to_lowercase().contains("error") && !temp_path.exists() {
                let _ = std::fs::remove_file(&temp_path);
                return Err(output.trim().to_string());
            }
            if !temp_path.exists() {
                return Err(format!(
                    "ExifTool did not create output file: {}",
                    temp_str
                ));
            }
            std::fs::rename(&temp_path, path)
                .map_err(|e| {
                    let _ = std::fs::remove_file(&temp_path);
                    format!("rename failed: {}", e)
                })
        }
        Err(e) => {
            let _ = std::fs::remove_file(&temp_path);
            Err(e)
        }
    }
}

fn write_sidecar(
    exiftool: &mut ExiftoolProcess,
    raw_path: &Path,
    sidecar_path: &Path,
    tag_args: &[String],
) -> Result<(), String> {
    let stem = sidecar_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("sidecar");
    let dir = sidecar_path.parent().unwrap_or_else(|| Path::new("."));
    let temp_path = dir.join(format!("{}_pmtmp.xmp", stem));
    let temp_str = temp_path.to_string_lossy().into_owned();
    let sidecar_str = sidecar_path.to_string_lossy().into_owned();
    let raw_str = raw_path.to_string_lossy().into_owned();

    let _ = std::fs::remove_file(&temp_path);

    // When a sidecar exists, use it as the source so all existing XMP tags are
    // preserved. When there is no sidecar yet, seed from the RAW file's embedded
    // metadata. In both cases ExifTool writes to a temp file; we rename afterward
    // to avoid reading from and writing to the same path simultaneously.
    let source = if sidecar_path.exists() { &sidecar_str } else { &raw_str };

    let mut args: Vec<&str> = Vec::new();
    for a in tag_args {
        args.push(a.as_str());
    }
    args.push("-o");
    args.push(temp_str.as_str());
    args.push(source.as_str());

    let result = exiftool.run_command(&args)?;
    if result.to_lowercase().contains("error") {
        let _ = std::fs::remove_file(&temp_path);
        return Err(result.trim().to_string());
    }
    if !temp_path.exists() {
        return Err(format!("ExifTool did not create sidecar at {}", temp_str));
    }
    std::fs::rename(&temp_path, sidecar_path).map_err(|e| {
        let _ = std::fs::remove_file(&temp_path);
        format!("rename sidecar failed: {}", e)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn make_write(fields: Vec<(&str, Option<&str>)>) -> PhotoWrite {
        PhotoWrite {
            photo_id: "test".into(),
            file_path: PathBuf::from("/tmp/photo.jpg"),
            fields: fields
                .into_iter()
                .map(|(f, v)| FieldWrite {
                    field: f.to_string(),
                    value: v.map(|s| s.to_string()),
                })
                .collect(),
            utc_offset: None,
        }
    }

    fn find_arg(args: &[String], prefix: &str) -> Option<String> {
        args.iter()
            .find(|a| a.starts_with(prefix))
            .cloned()
    }

    fn has_arg(args: &[String], arg: &str) -> bool {
        args.iter().any(|a| a == arg)
    }

    #[test]
    fn gps_ref_positive_lat_is_n() {
        let w = make_write(vec![("gps_lat", Some("37.7749"))]);
        let args = build_exiftool_args(&w);
        assert!(has_arg(&args, "-GPSLatitudeRef=N"));
        // The coordinate itself must be written signed (issue #21).
        assert!(has_arg(&args, "-GPSLatitude=37.7749"));
    }

    #[test]
    fn gps_ref_negative_lat_is_s() {
        let w = make_write(vec![("gps_lat", Some("-33.8688"))]);
        let args = build_exiftool_args(&w);
        assert!(has_arg(&args, "-GPSLatitudeRef=S"));
        // Sign is preserved on the coordinate, not stripped to abs (issue #21).
        assert!(has_arg(&args, "-GPSLatitude=-33.8688"));
    }

    #[test]
    fn gps_ref_positive_lng_is_e() {
        let w = make_write(vec![("gps_lng", Some("151.2093"))]);
        let args = build_exiftool_args(&w);
        assert!(has_arg(&args, "-GPSLongitudeRef=E"));
        assert!(has_arg(&args, "-GPSLongitude=151.2093"));
    }

    #[test]
    fn gps_ref_negative_lng_is_w() {
        let w = make_write(vec![("gps_lng", Some("-122.4194"))]);
        let args = build_exiftool_args(&w);
        assert!(has_arg(&args, "-GPSLongitudeRef=W"));
        // Regression guard for issue #21: a western-hemisphere longitude must
        // reach ExifTool as a negative number, otherwise XMP sidecars record it
        // as East and Lightroom shows the photo in the wrong hemisphere.
        assert!(has_arg(&args, "-GPSLongitude=-122.4194"));
    }

    #[test]
    fn camera_make_written_directly() {
        let w = make_write(vec![("camera_make", Some("Canon"))]);
        let args = build_exiftool_args(&w);
        assert!(has_arg(&args, "-Make=Canon"));
    }

    #[test]
    fn camera_model_written_directly() {
        let w = make_write(vec![("camera_model", Some("EOS R5"))]);
        let args = build_exiftool_args(&w);
        assert!(has_arg(&args, "-Model=EOS R5"));
    }

    #[test]
    fn camera_make_null_clears_tag() {
        let w = make_write(vec![("camera_make", None)]);
        let args = build_exiftool_args(&w);
        assert!(has_arg(&args, "-Make="));
    }

    #[test]
    fn datetime_merge() {
        let mut w = make_write(vec![
            ("capture_date", Some("2024-03-15")),
            ("capture_time", Some("14:30:00")),
        ]);
        w.utc_offset = Some("-07:00".into());
        let args = build_exiftool_args(&w);
        assert!(has_arg(&args, "-DateTimeOriginal=2024:03:15 14:30:00"));
        assert!(has_arg(&args, "-CreateDate=2024:03:15 14:30:00"));
        assert!(has_arg(&args, "-ModifyDate=2024:03:15 14:30:00"));
        assert!(has_arg(&args, "-FileModifyDate=2024:03:15 14:30:00"));
        assert!(has_arg(&args, "-OffsetTimeOriginal=-07:00"));
    }

    #[test]
    fn datetime_date_only_defaults_to_midnight() {
        let w = make_write(vec![("capture_date", Some("2024-03-15"))]);
        let args = build_exiftool_args(&w);
        assert!(has_arg(&args, "-DateTimeOriginal=2024:03:15 00:00:00"));
        assert!(has_arg(&args, "-CreateDate=2024:03:15 00:00:00"));
        assert!(has_arg(&args, "-ModifyDate=2024:03:15 00:00:00"));
        assert!(has_arg(&args, "-FileModifyDate=2024:03:15 00:00:00"));
    }

    #[test]
    fn null_capture_date_clears_datetime() {
        let w = make_write(vec![("capture_date", None)]);
        let args = build_exiftool_args(&w);
        assert!(has_arg(&args, "-DateTimeOriginal="));
        assert!(has_arg(&args, "-CreateDate="));
        assert!(has_arg(&args, "-ModifyDate="));
        assert!(has_arg(&args, "-OffsetTimeOriginal="));
    }

    #[test]
    fn film_vendor_and_type_combined() {
        let w = make_write(vec![("film_vendor", Some("Kodak")), ("film_type", Some("Portra 400"))]);
        let args = build_exiftool_args(&w);
        assert!(has_arg(&args, "-XMP-pm:FilmStock=Kodak Portra 400"));
    }

    #[test]
    fn film_vendor_only_no_type() {
        let w = make_write(vec![("film_vendor", Some("Kodak")), ("film_type", None)]);
        let args = build_exiftool_args(&w);
        assert!(has_arg(&args, "-XMP-pm:FilmStock=Kodak"));
    }

    #[test]
    fn film_vendor_null_clears_field() {
        let w = make_write(vec![("film_vendor", None)]);
        let args = build_exiftool_args(&w);
        assert!(has_arg(&args, "-XMP-pm:FilmStock="));
    }

    #[test]
    fn raw_extension_gives_sidecar_target() {
        for ext in &["cr3", "nef", "arw", "raf", "dng", "cr2", "orf", "rw2"] {
            let path = PathBuf::from(format!("/tmp/photo.{}", ext));
            match write_target(&path) {
                WriteTarget::Sidecar(_) => {}
                WriteTarget::Inline(_) => panic!(".{} should be Sidecar", ext),
            }
        }
    }

    #[test]
    fn jpeg_extension_gives_inline_target() {
        for ext in &["jpg", "jpeg", "JPG", "JPEG"] {
            let path = PathBuf::from(format!("/tmp/photo.{}", ext));
            match write_target(&path) {
                WriteTarget::Inline(_) => {}
                WriteTarget::Sidecar(_) => panic!(".{} should be Inline", ext),
            }
        }
    }

    #[test]
    fn tiff_extension_gives_inline_target() {
        for ext in &["tif", "tiff"] {
            let path = PathBuf::from(format!("/tmp/photo.{}", ext));
            match write_target(&path) {
                WriteTarget::Inline(_) => {}
                WriteTarget::Sidecar(_) => panic!(".{} should be Inline", ext),
            }
        }
    }

    #[test]
    fn heic_extension_gives_inline_target() {
        let path = PathBuf::from("/tmp/photo.heic");
        match write_target(&path) {
            WriteTarget::Inline(_) => {}
            WriteTarget::Sidecar(_) => panic!(".heic should be Inline"),
        }
    }

    /// Locate a usable exiftool for the round-trip test, or None to skip it on
    /// machines/CI without one installed.
    fn find_exiftool() -> Option<PathBuf> {
        for path in ["/opt/homebrew/bin/exiftool", "/usr/local/bin/exiftool"] {
            if std::path::Path::new(path).exists() {
                return Some(PathBuf::from(path));
            }
        }
        // Fall back to PATH lookup.
        std::process::Command::new("exiftool")
            .arg("-ver")
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|_| PathBuf::from("exiftool"))
    }

    /// End-to-end regression test for issue #21: a western-hemisphere coordinate
    /// written to an XMP sidecar must read back as West/negative, not East.
    ///
    /// The pre-fix string-only assertions could not catch this bug because
    /// ExifTool silently ignores the separate -GPSLongitudeRef arg for XMP and
    /// derives the hemisphere from the sign of the value. This test actually runs
    /// ExifTool against a temp .xmp so the sign handling is exercised for real.
    #[test]
    fn gps_signed_roundtrips_west_in_xmp_sidecar() {
        let Some(exiftool) = find_exiftool() else {
            eprintln!("skipping gps_signed_roundtrips_west_in_xmp_sidecar: exiftool not found");
            return;
        };

        // Colorado: north latitude, west longitude.
        let w = make_write(vec![
            ("gps_lat", Some("40.526687")),
            ("gps_lng", Some("-105.601172")),
        ]);
        let args = build_exiftool_args(&w);

        // TempDir cleans up on drop even if an assertion below panics, matching
        // the convention in tests/import_integration.rs.
        let dir = tempfile::TempDir::new().expect("create temp dir");
        let xmp = dir.path().join("gps_test.xmp");

        let status = std::process::Command::new(&exiftool)
            .args(&args)
            .arg("-o")
            .arg(&xmp)
            .output()
            .expect("run exiftool to create sidecar");
        assert!(
            xmp.exists(),
            "exiftool did not create sidecar: {}",
            String::from_utf8_lossy(&status.stderr)
        );

        // Read back as numeric signed decimals.
        let out = std::process::Command::new(&exiftool)
            .args(["-n", "-json", "-GPSLatitude", "-GPSLongitude"])
            .arg(&xmp)
            .output()
            .expect("run exiftool to read sidecar");
        let json: serde_json::Value =
            serde_json::from_slice(&out.stdout).expect("parse exiftool json");
        let obj = &json.as_array().unwrap()[0];
        let lat = obj["GPSLatitude"].as_f64().expect("lat present");
        let lng = obj["GPSLongitude"].as_f64().expect("lng present");

        assert!(lat > 0.0, "latitude should stay in the northern hemisphere, got {lat}");
        assert!(
            lng < 0.0,
            "longitude must round-trip as West (negative); got {lng} — issue #21 regression"
        );
    }
}
