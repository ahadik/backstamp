import { useEffect, useMemo, useState } from "react";
import type { Photo, Metadata } from "../../../state/SessionContext";
import type { DropTarget } from "../../../hooks/useDragDrop";
import {
  computeInheritance,
  hasGroupData,
  GROUP_FIELDS,
  type DropSettings,
  type GapMode,
  type InheritGroup,
} from "../../../hooks/useMetadataInheritance";
import { Modal } from "../Modal/Modal";
import styles from "./DropSettingsDialog.module.css";

/** Everything captured at drop time, held while the dialog is open so the
 *  drop can be applied on Accept or discarded entirely on Cancel. */
export interface PendingDrop {
  draggingIds: string[];
  draggingPhotos: Photo[];
  target: DropTarget;
  targetPhoto: Photo | null;
  neighborBefore: Photo | null;
  neighborAfter: Photo | null;
}

interface DropSettingsDialogProps {
  drop: PendingDrop;
  initialSettings: DropSettings;
  onResolve: (settings: DropSettings | null) => void;
}

const GROUP_LABELS: Record<InheritGroup, string> = {
  timestamp: "Date & time",
  location: "Location",
  camera: "Camera & film",
};

/** Snaps a remembered gapMode away from a side whose neighbor doesn't exist
 *  (edge-of-block gaps), so the dialog never shows a disabled option selected. */
function snapToAvailable(settings: DropSettings, drop: PendingDrop): DropSettings {
  if (drop.target.kind === "photo") return settings;
  const snap = (group: InheritGroup, s: { enabled: boolean; gapMode: GapMode }) => {
    if (s.gapMode === "before" && !drop.neighborBefore) {
      return { ...s, gapMode: group === "camera" ? ("after" as GapMode) : ("interpolate" as GapMode) };
    }
    if (s.gapMode === "after" && !drop.neighborAfter) {
      return { ...s, gapMode: group === "camera" ? ("before" as GapMode) : ("interpolate" as GapMode) };
    }
    return s;
  };
  return {
    timestamp: snap("timestamp", settings.timestamp),
    location: snap("location", settings.location),
    camera: snap("camera", settings.camera),
  };
}

function fmtTimestamp(c: Partial<Metadata> | undefined): string | null {
  if (!c) return null;
  const parts = [c.captureDate, c.captureTime].filter(
    (v): v is string => typeof v === "string"
  );
  return parts.length > 0 ? parts.join(" ") : null;
}

function fmtLocation(c: Partial<Metadata> | undefined): string | null {
  if (!c || typeof c.gpsLat !== "number" || typeof c.gpsLng !== "number") return null;
  return `${c.gpsLat.toFixed(5)}, ${c.gpsLng.toFixed(5)}`;
}

function fmtCamera(c: Partial<Metadata> | undefined): string | null {
  if (!c) return null;
  const parts: string[] = [];
  const cameraStr = [c.cameraMake, c.cameraModel].filter(Boolean).join(" ");
  if (cameraStr) parts.push(cameraStr);
  if (c.lens) parts.push(c.lens);
  const filmStr = [c.filmVendor, c.filmType].filter(Boolean).join(" ");
  if (filmStr) parts.push(filmStr);
  return parts.length > 0 ? parts.join(" · ") : null;
}

const FORMATTERS: Record<InheritGroup, (c: Partial<Metadata> | undefined) => string | null> = {
  timestamp: fmtTimestamp,
  location: fmtLocation,
  camera: fmtCamera,
};

export function DropSettingsDialog({ drop, initialSettings, onResolve }: DropSettingsDialogProps) {
  const isClone = drop.target.kind === "photo";
  const [settings, setSettings] = useState<DropSettings>(() =>
    snapToAvailable(initialSettings, drop)
  );

  // Preview always shows what each group WOULD set; the enabled checkbox
  // controls whether it applies. Enable everything for the preview computation.
  const previewChanges = useMemo(() => {
    const allEnabled: DropSettings = {
      timestamp: { ...settings.timestamp, enabled: true },
      location: { ...settings.location, enabled: true },
      camera: { ...settings.camera, enabled: true },
    };
    return computeInheritance(
      drop.draggingPhotos,
      drop.target,
      drop.targetPhoto,
      drop.neighborBefore,
      drop.neighborAfter,
      allEnabled,
    );
  }, [settings, drop]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Enter") {
        e.preventDefault();
        onResolve(settings);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [settings, onResolve]);

  function previewFor(group: InheritGroup): string {
    const photos = drop.draggingPhotos;
    if (photos.length === 0) return "—";
    const first = FORMATTERS[group](previewChanges.get(photos[0].id));
    const last = FORMATTERS[group](previewChanges.get(photos[photos.length - 1].id));
    if (first === null && last === null) return "Nothing to inherit";
    if (photos.length === 1 || first === last) return first ?? last ?? "—";
    return `${first ?? "—"} → ${last ?? "—"}`;
  }

  function setEnabled(group: InheritGroup, enabled: boolean) {
    setSettings((s) => ({ ...s, [group]: { ...s[group], enabled } }));
  }

  function setGapMode(group: InheritGroup, gapMode: GapMode) {
    setSettings((s) => ({ ...s, [group]: { ...s[group], gapMode } }));
  }

  function renderRow(group: InheritGroup) {
    const setting = settings[group];
    // Whether any source photo has data for this group at all. When nothing is
    // available the row is shown fully disabled; the underlying setting is left
    // untouched so a one-off drop next to bare neighbors doesn't rewrite the
    // remembered preference (applying an enabled-but-empty group is a no-op).
    const available = isClone
      ? hasGroupData(drop.targetPhoto, group)
      : hasGroupData(drop.neighborBefore, group) || hasGroupData(drop.neighborAfter, group);
    if (!available) {
      return (
        <div key={group} className={styles.row}>
          <label className={styles.rowHeaderDisabled}>
            <input type="checkbox" checked={false} disabled readOnly />
            <span className={styles.rowLabelDisabled}>{GROUP_LABELS[group]}</span>
          </label>
          <div className={styles.previewDisabled}>Nothing to inherit</div>
        </div>
      );
    }
    // Hide the source selector when every option would produce the same result:
    // both neighbors hold identical values for the group, or only one side has
    // data and the group can't interpolate (adopt-either-side falls back to it).
    // Timestamp with a single neighbor keeps its selector — adopting copies the
    // neighbor's time verbatim while interpolating staggers by 1 min per photo.
    const before = drop.neighborBefore;
    const after = drop.neighborAfter;
    let choiceMatters: boolean;
    if (hasGroupData(before, group) && hasGroupData(after, group)) {
      choiceMatters = GROUP_FIELDS[group].some(
        (f) => before!.currentMetadata[f] !== after!.currentMetadata[f],
      );
    } else {
      choiceMatters = group === "timestamp";
    }
    const edgeInterpolateNote =
      !isClone &&
      group === "timestamp" &&
      setting.gapMode === "interpolate" &&
      (!drop.neighborBefore || !drop.neighborAfter);
    return (
      <div key={group} className={styles.row}>
        <label className={styles.rowHeader}>
          <input
            type="checkbox"
            checked={setting.enabled}
            onChange={(e) => setEnabled(group, e.target.checked)}
          />
          <span className={styles.rowLabel}>{GROUP_LABELS[group]}</span>
        </label>
        {!isClone && choiceMatters && (
          <div className={styles.segmented} role="radiogroup" aria-label={`${GROUP_LABELS[group]} source`}>
            <button
              className={setting.gapMode === "before" ? styles.segmentActive : styles.segment}
              disabled={!drop.neighborBefore || !setting.enabled}
              onClick={() => setGapMode(group, "before")}
            >
              Copy Left
            </button>
            {group !== "camera" && (
              <button
                className={setting.gapMode === "interpolate" ? styles.segmentActive : styles.segment}
                disabled={!setting.enabled}
                onClick={() => setGapMode(group, "interpolate")}
              >
                Interpolate Between
              </button>
            )}
            <button
              className={setting.gapMode === "after" ? styles.segmentActive : styles.segment}
              disabled={!drop.neighborAfter || !setting.enabled}
              onClick={() => setGapMode(group, "after")}
            >
              Copy Right
            </button>
          </div>
        )}
        <div className={setting.enabled ? styles.preview : styles.previewDisabled}>
          {setting.enabled ? previewFor(group) : "Don't inherit"}
        </div>
        {edgeInterpolateNote && (
          <div className={styles.note}>
            One neighbor is missing — times are offset from the neighbor by 1 minute per photo.
          </div>
        )}
      </div>
    );
  }

  const count = drop.draggingPhotos.length;

  return (
    <Modal isOpen onClose={() => onResolve(null)} closeOnBackdrop={false} closeOnEscape>
      <div className={styles.dialog}>
        <h3 className={styles.title}>
          {isClone ? "Clone settings from photo" : "Inherit settings from neighbors"}
        </h3>
        <p className={styles.subtitle}>
          {count === 1 ? "1 photo" : `${count} photos`} will {isClone ? "adopt the target photo's values" : "take values from the photos on either side"}.
        </p>
        {isClone ? (
          <div className={styles.rows}>
            {(["timestamp", "location", "camera"] as InheritGroup[]).map(renderRow)}
          </div>
        ) : (
          <>
            <div className={styles.sectionLabel}>Interpolate</div>
            <div className={styles.rows}>
              {(["timestamp", "location"] as InheritGroup[]).map(renderRow)}
            </div>
            <div className={styles.sectionLabel}>Copy</div>
            <div className={styles.rows}>{renderRow("camera")}</div>
          </>
        )}
        <p className={styles.hint}>
          In the future, hold ⌘ while dropping to adopt these settings automatically.
        </p>
        <div className={styles.actions}>
          <button className="btn" onClick={() => onResolve(null)}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => onResolve(settings)}>
            Accept
          </button>
        </div>
      </div>
    </Modal>
  );
}
