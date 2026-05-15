import { useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { GpxFile } from "../../../state/SessionContext";
import styles from "./GpxTile.module.css";

interface Props {
  gpxFile: GpxFile;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}

function formatTimeRange(
  trackPoints: GpxFile["trackPoints"],
  timezone: string
): string | null {
  if (trackPoints.length === 0) return null;

  const startMs = trackPoints[0].timestamp * 1000;
  const endMs = trackPoints[trackPoints.length - 1].timestamp * 1000;

  const timeFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const dateFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
  });
  const tzAbbr =
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "short",
    })
      .formatToParts(startMs)
      .find((p) => p.type === "timeZoneName")?.value ?? "";

  const startDate = dateFmt.format(startMs);
  const endDate = dateFmt.format(endMs);
  const startTime = timeFmt.format(startMs);
  const endTime = timeFmt.format(endMs);

  if (startDate === endDate) {
    return `${startDate}  ${startTime}–${endTime} ${tzAbbr}`;
  }
  return `${startDate} ${startTime} – ${endDate} ${endTime} ${tzAbbr}`;
}

export function GpxTile({ gpxFile, isSelected, onSelect, onRemove }: Props) {
  const [hovered, setHovered] = useState(false);
  const timeRange = formatTimeRange(gpxFile.trackPoints, gpxFile.timezone ?? "UTC");

  return (
    <div
      className={`${styles.tile}${isSelected ? ` ${styles.selected}` : ""}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onSelect(gpxFile.id)}
    >
      {gpxFile.thumbnailPath ? (
        <img
          className={styles.thumbnail}
          src={convertFileSrc(gpxFile.thumbnailPath)}
          alt="GPX route"
        />
      ) : (
        <div className={styles.placeholder}>
          <span className={styles.routeIcon}>〰</span>
        </div>
      )}
      <div className={styles.label}>
        {gpxFile.filePath.split("/").pop()}
      </div>
      {timeRange && (
        <div className={styles.timeRange}>{timeRange}</div>
      )}
      {hovered && (
        <button
          className={styles.removeBtn}
          onClick={(e) => { e.stopPropagation(); onRemove(gpxFile.id); }}
          title="Remove GPX file"
        >
          ✕
        </button>
      )}
    </div>
  );
}
