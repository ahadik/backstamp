use gpx::{read, Gpx};
use std::io::BufReader;
use std::fs::File;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TrackPoint {
    pub lat: f64,
    pub lng: f64,
    /// Unix epoch seconds (UTC)
    pub timestamp: i64,
}

/// Parse a GPX file and return all track points sorted by timestamp.
pub fn parse_gpx(path: &str) -> Result<Vec<TrackPoint>, String> {
    let file = File::open(path).map_err(|e| format!("open {path}: {e}"))?;
    let reader = BufReader::new(file);
    let gpx: Gpx = read(reader).map_err(|e| format!("parse {path}: {e}"))?;

    let mut points: Vec<TrackPoint> = gpx
        .tracks
        .iter()
        .flat_map(|t| t.segments.iter())
        .flat_map(|s| s.points.iter())
        .filter_map(|wp| {
            let lat = wp.point().y();
            let lng = wp.point().x();
            let ts = time::OffsetDateTime::from(wp.time?).unix_timestamp();
            Some(TrackPoint { lat, lng, timestamp: ts })
        })
        .collect();

    points.sort_by_key(|p| p.timestamp);
    Ok(points)
}

/// Return the [min_ts, max_ts] range for a set of track points, or None if empty.
pub fn timestamp_range(points: &[TrackPoint]) -> Option<(i64, i64)> {
    if points.is_empty() {
        return None;
    }
    let min = points.first().unwrap().timestamp;
    let max = points.last().unwrap().timestamp;
    Some((min, max))
}

/// Returns true if [a_min, a_max] and [b_min, b_max] overlap (inclusive).
pub fn ranges_overlap(a: (i64, i64), b: (i64, i64)) -> bool {
    a.0 <= b.1 && b.0 <= a.1
}

/// Find the closest track point to `target_utc_secs`.
/// Returns interpolated lat/lng if `target_utc_secs` falls between two points;
/// returns exact point if it falls on or within `tolerance_secs` of a point.
/// Returns None if no point is within tolerance.
pub fn match_to_track(
    points: &[TrackPoint],
    target_utc_secs: i64,
    tolerance_secs: i64,
) -> Option<(f64, f64)> {
    if points.is_empty() {
        return None;
    }

    let idx = points.partition_point(|p| p.timestamp <= target_utc_secs);

    let before = idx.checked_sub(1).map(|i| &points[i]);
    let after = points.get(idx);

    match (before, after) {
        (None, Some(p)) => {
            if (p.timestamp - target_utc_secs).abs() <= tolerance_secs {
                Some((p.lat, p.lng))
            } else {
                None
            }
        }
        (Some(p), None) => {
            if (target_utc_secs - p.timestamp).abs() <= tolerance_secs {
                Some((p.lat, p.lng))
            } else {
                None
            }
        }
        (Some(b), Some(a)) => {
            let dist_b = (target_utc_secs - b.timestamp).abs();
            let dist_a = (a.timestamp - target_utc_secs).abs();

            if dist_b <= tolerance_secs || dist_a <= tolerance_secs {
                let total = (a.timestamp - b.timestamp) as f64;
                if total == 0.0 {
                    return Some((b.lat, b.lng));
                }
                let t = (target_utc_secs - b.timestamp) as f64 / total;
                let lat = b.lat + t * (a.lat - b.lat);
                let lng = b.lng + t * (a.lng - b.lng);
                Some((lat, lng))
            } else {
                None
            }
        }
        (None, None) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pts(data: &[(i64, f64, f64)]) -> Vec<TrackPoint> {
        data.iter()
            .map(|&(ts, lat, lng)| TrackPoint { lat, lng, timestamp: ts })
            .collect()
    }

    #[test]
    fn exact_match() {
        let p = pts(&[(100, 37.0, -122.0)]);
        assert_eq!(match_to_track(&p, 100, 60), Some((37.0, -122.0)));
    }

    #[test]
    fn within_tolerance() {
        let p = pts(&[(100, 37.0, -122.0)]);
        assert_eq!(match_to_track(&p, 145, 60), Some((37.0, -122.0)));
        assert_eq!(match_to_track(&p, 161, 60), None);
    }

    #[test]
    fn interpolation() {
        let p = pts(&[(0, 0.0, 0.0), (100, 10.0, 10.0)]);
        let result = match_to_track(&p, 50, 60);
        assert!(result.is_some());
        let (lat, lng) = result.unwrap();
        assert!((lat - 5.0).abs() < 0.001);
        assert!((lng - 5.0).abs() < 0.001);
    }

    #[test]
    fn overlap_detection() {
        assert!(ranges_overlap((0, 100), (50, 150)));
        assert!(ranges_overlap((0, 100), (100, 200)));
        assert!(!ranges_overlap((0, 99), (100, 200)));
    }

    #[test]
    fn empty_points() {
        assert_eq!(match_to_track(&[], 50, 60), None);
        assert_eq!(timestamp_range(&[]), None);
    }
}
