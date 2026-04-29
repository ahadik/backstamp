use image::imageops::FilterType;
use image::ImageReader;
use sha2::{Digest, Sha256};
use std::io::Cursor;
use std::path::{Path, PathBuf};

use crate::exiftool::ExiftoolProcess;

pub struct ThumbnailPaths {
    pub small: PathBuf,
    pub large: PathBuf,
}

const SMALL_PX: u32 = 400;
const LARGE_PX: u32 = 2560;

pub fn generate_thumbnails(
    file_path: &Path,
    thumbnails_dir: &Path,
    exiftool: &mut ExiftoolProcess,
) -> Result<ThumbnailPaths, String> {
    let key = path_key(file_path);
    let small_path = thumbnails_dir.join(format!("{}_small.jpg", key));
    let large_path = thumbnails_dir.join(format!("{}_large.jpg", key));

    if small_path.exists() && large_path.exists() {
        return Ok(ThumbnailPaths { small: small_path, large: large_path });
    }

    let img = load_source_image(file_path, exiftool)?;

    save_thumbnail(&img, &small_path, SMALL_PX)?;
    save_thumbnail(&img, &large_path, LARGE_PX)?;

    Ok(ThumbnailPaths { small: small_path, large: large_path })
}

fn path_key(file_path: &Path) -> String {
    let mut hasher = Sha256::new();
    hasher.update(file_path.to_string_lossy().as_bytes());
    hex::encode(hasher.finalize())
}

fn load_source_image(
    file_path: &Path,
    exiftool: &mut ExiftoolProcess,
) -> Result<image::DynamicImage, String> {
    let ext = file_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_default();

    match ext.as_str() {
        "jpg" | "jpeg" | "tif" | "tiff" => {
            ImageReader::open(file_path)
                .map_err(|e| format!("open {}: {}", file_path.display(), e))?
                .with_guessed_format()
                .map_err(|e| format!("guess format: {}", e))?
                .decode()
                .map_err(|e| format!("decode {}: {}", file_path.display(), e))
        }
        _ => {
            // HEIC and all RAW formats: extract embedded preview via ExifTool
            let tmp = tempfile::Builder::new()
                .suffix(".jpg")
                .tempfile()
                .map_err(|e| format!("tempfile: {}", e))?;
            let found = exiftool.extract_preview(file_path, tmp.path())?;
            if !found {
                return Err(format!(
                    "no embedded preview in {}",
                    file_path.display()
                ));
            }
            let bytes = std::fs::read(tmp.path())
                .map_err(|e| format!("read preview: {}", e))?;
            ImageReader::new(Cursor::new(bytes))
                .with_guessed_format()
                .map_err(|e| format!("guess preview format: {}", e))?
                .decode()
                .map_err(|e| format!("decode preview: {}", e))
        }
    }
}

fn save_thumbnail(
    img: &image::DynamicImage,
    output_path: &Path,
    target_px: u32,
) -> Result<(), String> {
    let (w, h) = (img.width(), img.height());
    let longest = w.max(h);

    let resized;
    let out = if longest <= target_px {
        img
    } else {
        let scale = target_px as f64 / longest as f64;
        let new_w = (w as f64 * scale).round() as u32;
        let new_h = (h as f64 * scale).round() as u32;
        resized = img.resize(new_w, new_h, FilterType::Lanczos3);
        &resized
    };

    let file = std::fs::File::create(output_path)
        .map_err(|e| format!("create {}: {}", output_path.display(), e))?;
    let mut encoder =
        image::codecs::jpeg::JpegEncoder::new_with_quality(std::io::BufWriter::new(file), 85);
    encoder
        .encode_image(out)
        .map_err(|e| format!("jpeg encode: {}", e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn make_image(width: u32, height: u32) -> image::DynamicImage {
        image::DynamicImage::ImageRgb8(image::RgbImage::new(width, height))
    }

    #[test]
    fn path_key_is_deterministic() {
        let k1 = path_key(Path::new("/some/path/photo.jpg"));
        let k2 = path_key(Path::new("/some/path/photo.jpg"));
        assert_eq!(k1, k2);
    }

    #[test]
    fn path_key_differs_for_different_paths() {
        let k1 = path_key(Path::new("/photos/a.jpg"));
        let k2 = path_key(Path::new("/photos/b.jpg"));
        assert_ne!(k1, k2);
    }

    #[test]
    fn path_key_is_64_char_hex() {
        let key = path_key(Path::new("/test.jpg"));
        assert_eq!(key.len(), 64);
        assert!(key.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn no_upscale_when_image_smaller_than_target() {
        let dir = TempDir::new().unwrap();
        let img = make_image(200, 150);
        let out = dir.path().join("out.jpg");
        save_thumbnail(&img, &out, 400).unwrap();
        let result = image::open(&out).unwrap();
        assert_eq!(result.width(), 200);
        assert_eq!(result.height(), 150);
    }

    #[test]
    fn no_upscale_when_image_exactly_at_target() {
        let dir = TempDir::new().unwrap();
        let img = make_image(400, 300);
        let out = dir.path().join("out.jpg");
        save_thumbnail(&img, &out, 400).unwrap();
        let result = image::open(&out).unwrap();
        assert_eq!(result.width(), 400);
        assert_eq!(result.height(), 300);
    }

    #[test]
    fn resize_landscape_preserves_aspect_ratio() {
        let dir = TempDir::new().unwrap();
        let img = make_image(1200, 800);
        let out = dir.path().join("out.jpg");
        save_thumbnail(&img, &out, 400).unwrap();
        let result = image::open(&out).unwrap();
        assert_eq!(result.width(), 400);
        // 800 * (400/1200) ≈ 267
        assert!(result.height() >= 265 && result.height() <= 268,
            "expected ~267, got {}", result.height());
    }

    #[test]
    fn resize_portrait_uses_height_as_longest_edge() {
        let dir = TempDir::new().unwrap();
        let img = make_image(800, 1200);
        let out = dir.path().join("out.jpg");
        save_thumbnail(&img, &out, 400).unwrap();
        let result = image::open(&out).unwrap();
        assert_eq!(result.height(), 400);
        assert!(result.width() >= 265 && result.width() <= 268,
            "expected ~267, got {}", result.width());
    }

    #[test]
    fn output_file_is_created() {
        let dir = TempDir::new().unwrap();
        let img = make_image(100, 100);
        let out = dir.path().join("thumb.jpg");
        assert!(!out.exists());
        save_thumbnail(&img, &out, 400).unwrap();
        assert!(out.exists());
    }
}
