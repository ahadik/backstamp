use image::imageops::FilterType;
use image::{ImageReader, Limits};
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

/// Upper bound on a single image dimension we are willing to decode.
/// 65,535 is the hard maximum for JPEG; a TIFF beyond that is almost certainly
/// corrupt rather than a real scan. This stays as a sanity guard while the
/// memory cap is removed (see `decode_limits`).
const MAX_DIMENSION_PX: u32 = 65_535;

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

    // Resize before applying orientation. Rotating allocates a full copy of the
    // image, so doing it on the 2560px version instead of the source keeps peak
    // memory at roughly one decoded copy rather than two.
    let large_img = resize_to(&img, LARGE_PX, FilterType::Lanczos3);
    drop(img);
    let orientation = exiftool.read_orientation(file_path).unwrap_or(1);
    let large_img = apply_orientation(large_img, orientation);
    save_jpeg(&large_img, &large_path)?;

    let small_img = resize_to(&large_img, SMALL_PX, FilterType::Triangle);
    save_jpeg(&small_img, &small_path)?;

    Ok(ThumbnailPaths { small: small_path, large: large_path })
}

pub(crate) fn path_key(file_path: &Path) -> String {
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
        "jpg" | "jpeg" => {
            decode_file(file_path)
        }
        "tif" | "tiff" => {
            // Try the embedded preview first — scanner TIFFs typically include
            // a JPEG preview and extracting it is orders of magnitude faster
            // than decoding the full multi-hundred-megapixel file.
            if let Some(img) = try_extract_preview(file_path, exiftool)? {
                return Ok(img);
            }
            decode_file(file_path)
        }
        _ => {
            // HEIC and all RAW formats: embedded preview is the only option.
            try_extract_preview(file_path, exiftool)?
                .ok_or_else(|| format!("no embedded preview in {}", file_path.display()))
        }
    }
}

fn try_extract_preview(
    file_path: &Path,
    exiftool: &mut ExiftoolProcess,
) -> Result<Option<image::DynamicImage>, String> {
    let tmp = tempfile::Builder::new()
        .suffix(".jpg")
        .tempfile()
        .map_err(|e| format!("tempfile: {}", e))?;
    let found = exiftool.extract_preview(file_path, tmp.path())?;
    if !found {
        return Ok(None);
    }
    let bytes = std::fs::read(tmp.path())
        .map_err(|e| format!("read preview: {}", e))?;
    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| format!("guess preview format: {}", e))?;
    reader.limits(decode_limits());
    let img = reader
        .decode()
        .map_err(|e| format!("decode preview: {}", e))?;
    Ok(Some(img))
}

/// Decoding limits for source images.
///
/// The `image` crate defaults to a 512 MiB allocation cap, which exists to
/// protect servers from hostile uploads. For a desktop app decoding the user's
/// own photos it rejects perfectly ordinary large scans (roughly 170 MP at
/// 8-bit RGB, or 85 MP at 16-bit) with "Memory limit exceeded". We drop the
/// memory cap and keep only a dimension sanity check.
fn decode_limits() -> Limits {
    let mut limits = Limits::no_limits();
    limits.max_image_width = Some(MAX_DIMENSION_PX);
    limits.max_image_height = Some(MAX_DIMENSION_PX);
    limits
}

fn decode_file(file_path: &Path) -> Result<image::DynamicImage, String> {
    let mut reader = ImageReader::open(file_path)
        .map_err(|e| format!("open {}: {}", file_path.display(), e))?
        .with_guessed_format()
        .map_err(|e| format!("guess format: {}", e))?;
    reader.limits(decode_limits());
    reader
        .decode()
        .map_err(|e| format!("decode {}: {}", file_path.display(), e))
}

fn apply_orientation(img: image::DynamicImage, orientation: u32) -> image::DynamicImage {
    match orientation {
        2 => img.fliph(),
        3 => img.rotate180(),
        4 => img.flipv(),
        5 => img.rotate90().fliph(),
        6 => img.rotate90(),
        7 => img.rotate270().fliph(),
        8 => img.rotate270(),
        _ => img,
    }
}

fn resize_to(img: &image::DynamicImage, target_px: u32, filter: FilterType) -> image::DynamicImage {
    let (w, h) = (img.width(), img.height());
    let longest = w.max(h);
    if longest <= target_px {
        return img.clone();
    }
    let scale = target_px as f64 / longest as f64;
    let new_w = (w as f64 * scale).round() as u32;
    let new_h = (h as f64 * scale).round() as u32;
    img.resize(new_w, new_h, filter)
}

fn save_jpeg(img: &image::DynamicImage, output_path: &Path) -> Result<(), String> {
    let file = std::fs::File::create(output_path)
        .map_err(|e| format!("create {}: {}", output_path.display(), e))?;
    let mut encoder =
        image::codecs::jpeg::JpegEncoder::new_with_quality(std::io::BufWriter::new(file), 85);
    encoder
        .encode_image(img)
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
        save_jpeg(&resize_to(&img, 400, FilterType::Triangle), &out).unwrap();
        let result = image::open(&out).unwrap();
        assert_eq!(result.width(), 200);
        assert_eq!(result.height(), 150);
    }

    #[test]
    fn no_upscale_when_image_exactly_at_target() {
        let dir = TempDir::new().unwrap();
        let img = make_image(400, 300);
        let out = dir.path().join("out.jpg");
        save_jpeg(&resize_to(&img, 400, FilterType::Triangle), &out).unwrap();
        let result = image::open(&out).unwrap();
        assert_eq!(result.width(), 400);
        assert_eq!(result.height(), 300);
    }

    #[test]
    fn resize_landscape_preserves_aspect_ratio() {
        let dir = TempDir::new().unwrap();
        let img = make_image(1200, 800);
        let out = dir.path().join("out.jpg");
        save_jpeg(&resize_to(&img, 400, FilterType::Triangle), &out).unwrap();
        let result = image::open(&out).unwrap();
        assert_eq!(result.width(), 400);
        assert!(result.height() >= 265 && result.height() <= 268,
            "expected ~267, got {}", result.height());
    }

    #[test]
    fn resize_portrait_uses_height_as_longest_edge() {
        let dir = TempDir::new().unwrap();
        let img = make_image(800, 1200);
        let out = dir.path().join("out.jpg");
        save_jpeg(&resize_to(&img, 400, FilterType::Triangle), &out).unwrap();
        let result = image::open(&out).unwrap();
        assert_eq!(result.height(), 400);
        assert!(result.width() >= 265 && result.width() <= 268,
            "expected ~267, got {}", result.width());
    }

    #[test]
    fn orientation_applied_after_resize_swaps_dimensions() {
        // Simulates the generate_thumbnails pipeline order: resize, then orient.
        let img = make_image(1200, 800);
        let resized = resize_to(&img, 400, FilterType::Triangle);
        let oriented = apply_orientation(resized, 6);
        assert_eq!(oriented.width(), 267);
        assert_eq!(oriented.height(), 400);
    }

    #[test]
    fn decode_file_rejects_absurd_dimensions_but_not_large_allocations() {
        let limits = decode_limits();
        assert_eq!(limits.max_alloc, None);
        assert_eq!(limits.max_image_width, Some(MAX_DIMENSION_PX));
        assert_eq!(limits.max_image_height, Some(MAX_DIMENSION_PX));
    }

    /// Regression test for GitHub issue #13: a source image whose decoded size
    /// exceeds the `image` crate's 512 MiB default allocation cap must still
    /// decode. 14000 x 13000 x 3 bytes = ~546 MB, just over the old limit.
    ///
    /// Ignored by default because encoding and decoding a 182 MP image takes
    /// ~20 s in a debug build. Run it with:
    ///   cargo test --lib decode_file_handles_image_over_512mib -- --ignored
    #[test]
    #[ignore]
    fn decode_file_handles_image_over_512mib() {
        let dir = TempDir::new().unwrap();
        let src = dir.path().join("huge.jpg");
        let (w, h) = (14_000u32, 13_000u32);
        assert!(w as u64 * h as u64 * 3 > 512 * 1024 * 1024);
        save_jpeg(&make_image(w, h), &src).unwrap();

        // Sanity check: the default limits really do reject this file, so the
        // test is exercising the fix rather than passing vacuously.
        let default_err = ImageReader::open(&src)
            .unwrap()
            .with_guessed_format()
            .unwrap()
            .decode()
            .err()
            .map(|e| e.to_string())
            .unwrap_or_default();
        assert!(
            default_err.contains("Memory limit exceeded"),
            "expected default limits to fail, got: {:?}",
            default_err
        );

        let img = decode_file(&src).unwrap();
        assert_eq!(img.width(), w);
        assert_eq!(img.height(), h);

        let thumb = resize_to(&img, LARGE_PX, FilterType::Triangle);
        assert_eq!(thumb.width(), LARGE_PX);
    }

    #[test]
    fn output_file_is_created() {
        let dir = TempDir::new().unwrap();
        let img = make_image(100, 100);
        let out = dir.path().join("thumb.jpg");
        assert!(!out.exists());
        save_jpeg(&resize_to(&img, 400, FilterType::Triangle), &out).unwrap();
        assert!(out.exists());
    }
}
