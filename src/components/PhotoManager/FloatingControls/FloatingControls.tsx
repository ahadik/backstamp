import { useMemo, useState, useEffect, useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { tauriCommands } from "../../../lib/tauri";
import type { SessionLoadResult } from "../../../lib/tauri";
import type { Photo } from "../../../state/SessionContext";
import { ConfirmDialog } from "../../common/ConfirmDialog/ConfirmDialog";
import { ImportModal } from "../../ImportModal/ImportModal";
import { reportError } from "../../../lib/errors";
import { useUI } from "../../../state/UIContext";
import { useSession } from "../../../state/SessionContext";
import { WORKING_TIMEZONES } from "../../../lib/timezones";
import { formatZoneOffset, resolveZoneOffsets, todayDate } from "../../../lib/datetime";
import { GridSizeControl } from "./GridSizeControl";
import { FilterControls } from "./FilterControls";
import styles from "./FloatingControls.module.css";

const SUPPORTED_EXTENSIONS = [
  "jpg", "jpeg", "tif", "tiff", "heic",
  "dng", "cr3", "cr2", "nef", "arw", "raf", "orf", "rw2", "pef",
];

interface RefreshState {
  isOpen: boolean;
  done: number;
  total: number;
  isComplete: boolean;
  isCancelling: boolean;
  isCancelled: boolean;
  errors: string[];
}

const IDLE_REFRESH_STATE: RefreshState = {
  isOpen: false,
  done: 0,
  total: 0,
  isComplete: false,
  isCancelling: false,
  isCancelled: false,
  errors: [],
};

function mapLoadedPhoto(p: SessionLoadResult["photos"][number]): Photo {
  return {
    id: p.id,
    filePath: p.filePath,
    fileStatus: p.fileStatus,
    thumbnail: {
      small: convertFileSrc(p.thumbnailSmall),
      large: convertFileSrc(p.thumbnailLarge),
    },
    originalMetadata: p.originalMetadata,
    currentMetadata: p.currentMetadata,
    pendingChanges: p.pendingChanges ?? null,
  };
}

interface FloatingControlsProps {
  /** Routes paths (files or folders) through the shared import pipeline. */
  onImportPaths: (paths: string[]) => void;
}

export function FloatingControls({ onImportPaths }: FloatingControlsProps) {
  const { state: ui, dispatch } = useUI();
  const { state, dispatch: sessionDispatch } = useSession();
  const { selectedIds, photos, applyInProgress } = state;
  const [showRefreshConfirm, setShowRefreshConfirm] = useState(false);
  const [refreshState, setRefreshState] = useState<RefreshState>(IDLE_REFRESH_STATE);

  // The backend refresh thread reports through events; the session is reloaded
  // once it finishes so the grid shows the rebuilt baseline.
  useEffect(() => {
    const unlisteners = [
      listen<{ total: number }>("refresh:start", (e) => {
        setRefreshState({ ...IDLE_REFRESH_STATE, isOpen: true, total: e.payload.total });
      }),
      listen<{ done: number; total: number; error: string | null }>("refresh:progress", (e) => {
        const { done, total, error } = e.payload;
        setRefreshState((prev) => ({
          ...prev,
          done,
          total,
          errors: error ? [...prev.errors, error] : prev.errors,
        }));
      }),
      listen<{ total: number; refreshed: number; cancelled: boolean }>("refresh:complete", async (e) => {
        try {
          const session = await tauriCommands.loadSession();
          sessionDispatch({
            type: "REFRESH_PHOTOS",
            photos: session.photos.map(mapLoadedPhoto),
            canRollback: session.canRollback,
          });
        } catch (err) {
          reportError("Failed to reload photos after refreshing metadata", err);
        }
        setRefreshState((prev) => ({
          ...prev,
          isComplete: true,
          isCancelling: false,
          isCancelled: e.payload.cancelled,
        }));
      }),
    ];
    return () => {
      unlisteners.forEach((p) => p.then((fn) => fn()));
    };
  }, [sessionDispatch]);

  const handleDismissRefresh = useCallback(() => {
    setRefreshState(IDLE_REFRESH_STATE);
  }, []);

  const handleCancelRefresh = useCallback(() => {
    setRefreshState((prev) => ({ ...prev, isCancelling: true }));
    tauriCommands.refreshCancel().catch((err) => {
      setRefreshState((prev) => ({ ...prev, isCancelling: false }));
      reportError("Failed to cancel the metadata refresh", err);
    });
  }, []);

  function handleRefresh() {
    setShowRefreshConfirm(false);
    tauriCommands
      .refreshPhotos()
      .catch((err) => reportError("Failed to refresh metadata from disk", err));
  }

  // No photo in play here, so offsets resolve against today.
  const workingZoneOffsets = useMemo(
    () => resolveZoneOffsets(WORKING_TIMEZONES.map((tz) => tz.value), [todayDate()]),
    []
  );

  async function handleImportPhotos() {
    const selected = await open({
      multiple: true,
      filters: [{ name: "Photos", extensions: [...SUPPORTED_EXTENSIONS, "xmp", "gpx"] }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    if (paths.length === 0) return;
    onImportPaths(paths);
  }

  // The dialog plugin can't offer files and folders in one picker, so folder
  // import gets its own button.
  async function handleImportFolder() {
    const selected = await open({ directory: true, multiple: true });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    if (paths.length === 0) return;
    onImportPaths(paths);
  }

  async function handleRemoveSelected() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    await tauriCommands
      .removePhotos(ids)
      .catch((err) => reportError("Failed to remove photos", err));
    sessionDispatch({ type: "REMOVE_PHOTOS", ids });
  }

  function handleDragMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    if (e.button !== 0) return;
    const win = getCurrentWindow();
    if (e.detail === 2) {
      win.toggleMaximize();
    } else {
      win.startDragging();
    }
  }

  return (
    <div
      className={styles.floatingControls}
      data-tauri-drag-region
      onMouseDown={handleDragMouseDown}
    >
      <div className={styles.leftGroup}>
        <button className="btn btn-glass" onClick={handleImportPhotos}>
          Import Photos
        </button>
        <button className="btn btn-glass" onClick={handleImportFolder}>
          Import Folder
        </button>
        <button
          className="btn btn-glass"
          onClick={handleRemoveSelected}
          disabled={selectedIds.size === 0}
        >
          Remove Selected
        </button>
        <button
          className="btn btn-glass"
          onClick={() => setShowRefreshConfirm(true)}
          disabled={photos.length === 0 || applyInProgress || refreshState.isOpen}
        >
          Refresh from Disk
        </button>
      </div>
      <div className={styles.rightGroup}>
        <FilterControls />
        <select
          className={styles.tzSelect}
          value={ui.workingTimezone}
          onChange={(e) =>
            dispatch({ type: "SET_WORKING_TIMEZONE", timezone: e.target.value })
          }
        >
          {WORKING_TIMEZONES.map((tz) => {
            const resolved = workingZoneOffsets.get(tz.value);
            return (
              <option key={tz.value} value={tz.value}>
                {resolved ? `${tz.name} · ${formatZoneOffset(resolved)}` : tz.name}
              </option>
            );
          })}
        </select>
        <GridSizeControl />
      </div>

      {showRefreshConfirm && (
        <ConfirmDialog
          title="Refresh Metadata from Disk?"
          message={`Re-read the metadata of all ${photos.length} photo${photos.length !== 1 ? "s" : ""} from their files and use it as the new import baseline. Pending edits that have not been applied are discarded and Roll Back history is cleared. Photos are not re-imported and nothing is written to disk.`}
          confirmLabel="Refresh"
          destructive
          onConfirm={handleRefresh}
          onCancel={() => setShowRefreshConfirm(false)}
        />
      )}

      <ImportModal
        variant="refresh"
        isOpen={refreshState.isOpen}
        done={refreshState.done}
        total={refreshState.total}
        isComplete={refreshState.isComplete}
        isCancelling={refreshState.isCancelling}
        isCancelled={refreshState.isCancelled}
        errors={refreshState.errors}
        onCancel={handleCancelRefresh}
        onDismiss={handleDismissRefresh}
      />
    </div>
  );
}
