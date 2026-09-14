import { useEffect, useMemo, useRef, useState } from "react";
import { useUI } from "../../../state/UIContext";
import { useSession } from "../../../state/SessionContext";
import {
  cameraOptionsFrom,
  photoDateRange,
} from "../../../state/selectors";
import styles from "./FilterControls.module.css";

type PanelId = "time" | "camera";

/**
 * Metadata filter controls for the top bar. Collapsed, only a funnel icon
 * shows; activating it slides the Time and Camera dropdowns out to the left.
 * Deactivating the icon slides them away and clears all filters, so the
 * collapsed state always means "nothing filtered". Filters apply as values
 * change — panels close on outside click, no apply step.
 */
export function FilterControls() {
  const { state: ui, dispatch: uiDispatch } = useUI();
  const { state: session } = useSession();
  const [expanded, setExpanded] = useState(false);
  const [openPanel, setOpenPanel] = useState<PanelId | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const filters = ui.photoFilters;
  const timeActive = filters.dateAfter !== null || filters.dateBefore !== null;
  const selectedCameras = useMemo(() => new Set(filters.cameras ?? []), [filters.cameras]);
  const cameraActive = selectedCameras.size > 0;

  // Options always derive from the full photo set, so a value can't disappear
  // from the panel just because another filter currently hides its photos.
  const cameraOptions = useMemo(() => cameraOptionsFrom(session.photos), [session.photos]);
  const dateRange = useMemo(
    () => photoDateRange(session.photos, ui.workingTimezone),
    [session.photos, ui.workingTimezone]
  );

  useEffect(() => {
    if (!openPanel) return;
    function handleClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpenPanel(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [openPanel]);

  if (session.photos.length === 0) return null;

  function setDate(field: "dateAfter" | "dateBefore", value: string) {
    uiDispatch({ type: "SET_PHOTO_FILTERS", filters: { [field]: value || null } });
  }

  function toggleCamera(key: string) {
    const next = new Set(selectedCameras);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    // An emptied list means "no camera filter", not "hide everything".
    uiDispatch({
      type: "SET_PHOTO_FILTERS",
      filters: { cameras: next.size > 0 ? [...next] : null },
    });
  }

  function togglePanel(panel: PanelId) {
    setOpenPanel((open) => (open === panel ? null : panel));
  }

  function toggleExpanded() {
    setOpenPanel(null);
    if (expanded) uiDispatch({ type: "RESET_PHOTO_FILTERS" });
    setExpanded((v) => !v);
  }

  return (
    <div className={styles.filterControls} ref={rootRef}>
      <div
        className={`${styles.tray} ${expanded ? styles.trayExpanded : ""}`}
        inert={!expanded}
      >
        <button
          className={`btn btn-glass ${timeActive ? styles.activeButton : ""}`}
          onClick={() => togglePanel("time")}
        >
          Time ▾
        </button>
        <button
          className={`btn btn-glass ${cameraActive ? styles.activeButton : ""}`}
          onClick={() => togglePanel("camera")}
        >
          Camera ▾
        </button>
      </div>

      <button
        className={`${styles.iconButton} ${expanded ? styles.iconButtonActive : ""}`}
        title={expanded ? "Deactivate filters" : "Filter photos"}
        aria-label={expanded ? "Deactivate filters" : "Filter photos"}
        aria-expanded={expanded}
        onClick={toggleExpanded}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M1.5 2.5h13l-5 6v4.5l-3 1.5V8.5l-5-6z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {expanded && openPanel === "time" && (
        <div className={styles.panel}>
          {/* Unset bounds display the session's first/last photo dates, so the
              panel opens showing the full range rather than empty inputs. */}
          <label className={styles.dateField}>
            <span className={styles.fieldLabel}>On or after</span>
            <input
              type="date"
              className={styles.dateInput}
              value={filters.dateAfter ?? dateRange?.min ?? ""}
              min={dateRange?.min}
              max={filters.dateBefore ?? dateRange?.max}
              onChange={(e) => setDate("dateAfter", e.target.value)}
            />
          </label>
          <label className={styles.dateField}>
            <span className={styles.fieldLabel}>On or before</span>
            <input
              type="date"
              className={styles.dateInput}
              value={filters.dateBefore ?? dateRange?.max ?? ""}
              min={filters.dateAfter ?? dateRange?.min}
              max={dateRange?.max}
              onChange={(e) => setDate("dateBefore", e.target.value)}
            />
          </label>
          <div className={styles.panelFooter}>
            <button
              className="btn btn-ghost"
              disabled={!timeActive}
              onClick={() =>
                uiDispatch({
                  type: "SET_PHOTO_FILTERS",
                  filters: { dateAfter: null, dateBefore: null },
                })
              }
            >
              Reset
            </button>
          </div>
        </div>
      )}

      {expanded && openPanel === "camera" && (
        <div className={styles.panel}>
          <div className={styles.optionList}>
            {cameraOptions.map((option) => (
              <label key={option.key} className={styles.optionRow}>
                <input
                  type="checkbox"
                  checked={selectedCameras.has(option.key)}
                  onChange={() => toggleCamera(option.key)}
                />
                <span className={styles.optionLabel}>{option.label}</span>
                <span className={styles.optionCount}>{option.count}</span>
              </label>
            ))}
          </div>
          <div className={styles.panelFooter}>
            <button
              className="btn btn-ghost"
              disabled={!cameraActive}
              onClick={() =>
                uiDispatch({ type: "SET_PHOTO_FILTERS", filters: { cameras: null } })
              }
            >
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
