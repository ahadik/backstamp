import React, { useState, useRef, useEffect } from "react";
import { useSession } from "../../../state/SessionContext";
import { deriveFieldValue } from "../../../lib/inspectorUtils";
import { WORKING_TIMEZONES } from "../../../lib/timezones";
import { ConfirmDialog } from "../../common/ConfirmDialog/ConfirmDialog";
import type { Photo, Metadata } from "../../../state/SessionContext";
import styles from "./DateTimeSection.module.css";

/** Parse freeform time text to "HH:MM:SS", or null if unrecognised. */
export function parseTimeInput(input: string): string | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return null;

  const ampmMatch = s.match(/(am|pm)$/);
  const ampm = ampmMatch ? ampmMatch[1] : null;
  const timeStr = ampm ? s.slice(0, s.length - ampm.length) : s;

  let h: number;
  let m = 0;
  let sec = 0;

  const colonMatch = timeStr.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (colonMatch) {
    h = parseInt(colonMatch[1], 10);
    m = parseInt(colonMatch[2], 10);
    sec = colonMatch[3] !== undefined ? parseInt(colonMatch[3], 10) : 0;
  } else if (/^\d{1,2}$/.test(timeStr)) {
    h = parseInt(timeStr, 10);
  } else {
    return null;
  }

  if (m > 59 || sec > 59) return null;

  if (ampm === "am") {
    if (h === 12) h = 0;
    else if (h > 12) return null;
  } else if (ampm === "pm") {
    if (h !== 12) h += 12;
    if (h > 23) return null;
  } else {
    if (h > 23) return null;
  }

  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/** Format "HH:MM:SS" for display as "h:mm AM/PM". */
export function formatTimeDisplay(time24: string): string {
  const [hStr = "0", mStr = "0"] = time24.split(":");
  const h24 = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

export function getUtcOffset(ianaTimezone: string, date: Date): string {
  try {
    const fmt = new Intl.DateTimeFormat("en", {
      timeZone: ianaTimezone,
      timeZoneName: "shortOffset",
    });
    const parts = fmt.formatToParts(date);
    const offsetPart = parts.find((p) => p.type === "timeZoneName");
    if (!offsetPart) return "+00:00";
    const val = offsetPart.value;
    if (val === "GMT") return "+00:00";
    const match = val.match(/GMT([+-])(\d+)(?::(\d+))?/);
    if (!match) return "+00:00";
    const sign = match[1];
    const hours = match[2].padStart(2, "0");
    const mins = (match[3] ?? "00").padStart(2, "0");
    return `${sign}${hours}:${mins}`;
  } catch {
    return "+00:00";
  }
}

interface DateTimeSectionProps {
  selectedPhotos: Photo[];
}

interface PendingConfirm {
  changes: Partial<Metadata>;
  count: number;
}

export function DateTimeSection({ selectedPhotos }: DateTimeSectionProps) {
  const { dispatch } = useSession();

  const captureDate = deriveFieldValue(selectedPhotos, (m) => m.captureDate);
  const captureTime = deriveFieldValue(selectedPhotos, (m) => m.captureTime);
  const timezone = deriveFieldValue(selectedPhotos, (m) => m.timezone);

  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [tzSearch, setTzSearch] = useState("");
  const [tzOpen, setTzOpen] = useState(false);
  const [incrementHours, setIncrementHours] = useState(1);
  const [isTimeFocused, setIsTimeFocused] = useState(false);
  const [localTime, setLocalTime] = useState("");
  const timeOriginalRef = useRef("");
  const tzRef = useRef<HTMLDivElement>(null);

  const search = tzSearch.toLowerCase();
  const filteredCurated = WORKING_TIMEZONES.filter((tz) =>
    tz.label.toLowerCase().includes(search) ||
    tz.value.toLowerCase().includes(search)
  );
  const curatedValues = new Set(WORKING_TIMEZONES.map((tz) => tz.value));
  const extraIana: { value: string; label: string }[] = search
    ? Intl.supportedValuesOf("timeZone")
        .filter((tz) => !curatedValues.has(tz) && tz.toLowerCase().includes(search))
        .map((tz) => ({ value: tz, label: tz }))
    : [];
  const filteredTimezones = [...filteredCurated, ...extraIana];

  const selectedIds = selectedPhotos.map((p) => p.id);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (tzRef.current && !tzRef.current.contains(e.target as Node)) {
        setTzOpen(false);
        setTzSearch("");
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  function dispatchChanges(changes: Partial<Metadata>) {
    dispatch({ type: "SET_PENDING", ids: selectedIds, changes });
  }

  function maybeConfirm(
    currentValue: unknown,
    getValue: (m: Metadata) => unknown,
    changes: Partial<Metadata>
  ) {
    if (currentValue === "multiple") {
      const count = new Set(selectedPhotos.map((p) => getValue(p.currentMetadata))).size;
      setPendingConfirm({ changes, count });
    } else {
      dispatchChanges(changes);
    }
  }

  function handleDateChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    if (!value) return; // intermediate empty — browser is mid-edit, don't reset state
    const changes: Partial<Metadata> = { captureDate: value };
    const hasNoTime = selectedPhotos.every((p) => !p.currentMetadata.captureTime);
    if (hasNoTime) changes.captureTime = "00:00:00";
    maybeConfirm(captureDate, (m) => m.captureDate, changes);
  }

  function handleDateBlur(e: React.FocusEvent<HTMLInputElement>) {
    if (!e.target.value && captureDate && captureDate !== "multiple") {
      maybeConfirm(captureDate, (m) => m.captureDate, { captureDate: null });
    }
  }

  function handleTimeFocus() {
    setIsTimeFocused(true);
    const initial = timeRaw ?? "";
    setLocalTime(initial);
    timeOriginalRef.current = initial;
  }

  function handleTimeChange(e: React.ChangeEvent<HTMLInputElement>) {
    setLocalTime(e.target.value);
  }

  function handleTimeBlur(e: React.FocusEvent<HTMLInputElement>) {
    setIsTimeFocused(false);
    const parsed = parseTimeInput(e.target.value);
    if (parsed !== null) {
      maybeConfirm(captureTime, (m) => m.captureTime, { captureTime: parsed });
    } else {
      maybeConfirm(captureTime, (m) => m.captureTime, { captureTime: null });
    }
  }

  function handleTimezoneSelect(tz: string) {
    setTzOpen(false);
    setTzSearch("");
    maybeConfirm(timezone, (m) => m.timezone, { timezone: tz });
  }

  function handleIncrement(direction: 1 | -1) {
    const deltaSeconds = direction * incrementHours * 3600;
    for (const photo of selectedPhotos) {
      const { captureDate: cd, captureTime: ct } = photo.currentMetadata;
      if (!cd || !ct) continue;
      const [hStr, mStr, sStr] = ct.split(":");
      let totalSec =
        parseInt(hStr) * 3600 +
        parseInt(mStr) * 60 +
        parseInt(sStr ?? "0");
      totalSec += deltaSeconds;
      let dayDelta = 0;
      while (totalSec < 0) { totalSec += 86400; dayDelta--; }
      while (totalSec >= 86400) { totalSec -= 86400; dayDelta++; }
      const newH = Math.floor(totalSec / 3600).toString().padStart(2, "0");
      const newM = Math.floor((totalSec % 3600) / 60).toString().padStart(2, "0");
      const newS = (totalSec % 60).toString().padStart(2, "0");
      const newTime = `${newH}:${newM}:${newS}`;
      let newDate = cd;
      if (dayDelta !== 0) {
        const d = new Date(`${cd}T00:00:00`);
        d.setDate(d.getDate() + dayDelta);
        newDate = d.toISOString().slice(0, 10);
      }
      dispatch({
        type: "SET_PENDING",
        ids: [photo.id],
        changes: { captureDate: newDate, captureTime: newTime },
      });
    }
  }

  const incrementEnabled =
    selectedPhotos.length > 0 &&
    selectedPhotos.every(
      (p) => p.currentMetadata.captureDate && p.currentMetadata.captureTime
    );

  const isEmpty = selectedPhotos.length === 0;

  const dateInputValue =
    captureDate && captureDate !== "multiple" ? captureDate : "";


  const timeRaw =
    captureTime && captureTime !== "multiple"
      ? formatTimeDisplay(captureTime)
      : "";

  const tzOption = WORKING_TIMEZONES.find((tz) => tz.value === timezone);
  const tzDisplayValue = tzOption ? tzOption.label : (timezone && timezone !== "multiple" ? timezone : "");
  const tzPlaceholder =
    timezone === "multiple" ? "Multiple Values" : "Not set";

  return (
    <div className={styles.section}>
      <div className="section-label">Date &amp; Time</div>
      <div className={`inspector-card ${styles.card}`}>
        {isEmpty ? (
          <p className={styles.empty}>No photos selected</p>
        ) : (
          <>
            <div className={styles.row}>
              <span className={styles.label}>Date</span>
              <div className={styles.dateWrapper}>
                <input
                  type="date"
                  className={`input ${styles.dateInput}`}
                  value={dateInputValue}
                  onChange={handleDateChange}
                  onBlur={handleDateBlur}
                />
                {!dateInputValue && (
                  <span className={styles.datePlaceholder} aria-hidden>--/--/----</span>
                )}
              </div>
            </div>
            <div className={styles.row}>
              <span className={styles.label}>Time</span>
              <input
                type="text"
                className={`input ${styles.timeInput}`}
                value={isTimeFocused ? localTime : timeRaw}
                placeholder={captureTime === "multiple" ? "Multiple Values" : "--"}
                onFocus={handleTimeFocus}
                onChange={handleTimeChange}
                onBlur={handleTimeBlur}
              />
            </div>
            <div className={styles.row}>
              <span className={styles.label}>Timezone</span>
              <div ref={tzRef} className={styles.tzWrapper}>
                <input
                  type="text"
                  className={`input ${styles.tzInput}`}
                  value={tzOpen ? tzSearch : tzDisplayValue}
                  placeholder={tzPlaceholder}
                  onFocus={() => { setTzOpen(true); setTzSearch(""); }}
                  onChange={(e) => setTzSearch(e.target.value)}
                  readOnly={!tzOpen}
                />
                {tzOpen && (
                  <div className={styles.tzDropdown}>
                    {filteredTimezones.map((tz) => (
                      <button
                        key={tz.value}
                        className={styles.tzOption}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleTimezoneSelect(tz.value);
                        }}
                      >
                        {tz.label}
                      </button>
                    ))}
                    {filteredTimezones.length === 0 && (
                      <p className={styles.tzNoMatch}>No timezones match</p>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className={styles.incrementRow}>
              <button
                className={`btn btn-glass ${styles.incBtn}`}
                disabled={!incrementEnabled}
                title={!incrementEnabled ? "Set date and time first" : undefined}
                onClick={() => handleIncrement(-1)}
              >
                −
              </button>
              <input
                type="number"
                className={`input ${styles.incInput}`}
                value={incrementHours}
                min={1}
                disabled={!incrementEnabled}
                onChange={(e) =>
                  setIncrementHours(Math.max(1, parseInt(e.target.value) || 1))
                }
              />
              <span className={styles.incLabel}>hrs</span>
              <button
                className={`btn btn-glass ${styles.incBtn}`}
                disabled={!incrementEnabled}
                title={!incrementEnabled ? "Set date and time first" : undefined}
                onClick={() => handleIncrement(1)}
              >
                +
              </button>
            </div>
          </>
        )}
      </div>

      {pendingConfirm && (
        <ConfirmDialog
          title="Overwrite Multiple Values?"
          message={
            <>
              You are about to overwrite <strong>{pendingConfirm.count}</strong>{" "}
              different values with a single value. Continue?
            </>
          }
          confirmLabel="Overwrite"
          onConfirm={() => {
            dispatchChanges(pendingConfirm.changes);
            setPendingConfirm(null);
          }}
          onCancel={() => setPendingConfirm(null)}
        />
      )}
    </div>
  );
}
