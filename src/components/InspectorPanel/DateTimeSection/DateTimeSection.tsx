import React, { useState, useRef, useEffect, useMemo } from "react";
import { useSession } from "../../../state/SessionContext";
import { deriveFieldValue } from "../../../lib/inspectorUtils";
import { WORKING_TIMEZONES } from "../../../lib/timezones";
import {
  distinctCaptureDates,
  formatUtcOffset,
  formatZoneOffset,
  offsetToMinutes,
  resolveZoneOffsets,
  shiftWallClock,
  utcOffsetFor,
  wallClockInZone,
} from "../../../lib/datetime";
import { ConfirmDialog } from "../../common/ConfirmDialog/ConfirmDialog";
import { tauriCommands } from "../../../lib/tauri";
import { reportError } from "../../../lib/errors";
import type { Photo, Metadata } from "../../../state/SessionContext";
import styles from "./DateTimeSection.module.css";

function persistPending(ids: string[], changes: Partial<Metadata>) {
  const fields = Object.entries(changes).map(([field, value]) => ({
    field,
    value: value == null ? null : String(value),
  }));
  tauriCommands.setPendingChanges(ids, fields)
    .catch((err) => reportError("Failed to save date/time edits", err));
}

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


interface DateTimeSectionProps {
  selectedPhotos: Photo[];
}

interface PendingConfirm {
  count: number;
  /** Runs when the user confirms overwriting the multiple existing values. */
  proceed: () => void;
}

/**
 * A timezone selection whose offset disagrees with what the selected photos
 * currently carry, awaiting the user's choice of how to reconcile.
 */
interface TzMismatch {
  tz: string;
  tzName: string;
  /** The selection the zone was chosen for; it may change while the dialog is open. */
  photos: Photo[];
  mismatchCount: number;
  /** "UTC−7" — the chosen zone's offset, when uniform across mismatched photos. */
  zoneOffsetLabel: string | null;
  /** "UTC−8" — the photos' current offset, when uniform across mismatched photos. */
  currentOffsetLabel: string | null;
  /** Concrete before/after times, shown when exactly one photo mismatches. */
  sampleCurrentTime: string | null;
  sampleAdjustedTime: string | null;
}

export function DateTimeSection({ selectedPhotos }: DateTimeSectionProps) {
  const { dispatch } = useSession();

  const captureDate = deriveFieldValue(selectedPhotos, (m) => m.captureDate);
  const captureTime = deriveFieldValue(selectedPhotos, (m) => m.captureTime);
  // Strict: a photo without a timezone is in a different state than one with,
  // so mixed set/unset selections read as multiple rather than adopting the
  // set value. Same for the recorded offset below.
  const timezone = deriveFieldValue(selectedPhotos, (m) => m.timezone);

  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [tzMismatch, setTzMismatch] = useState<TzMismatch | null>(null);
  const [tzMismatchMode, setTzMismatchMode] = useState<"adjust" | "keep">("adjust");
  const [tzSearch, setTzSearch] = useState("");
  const [tzOpen, setTzOpen] = useState(false);
  const [incrementHours, setIncrementHours] = useState(1);
  const [isTimeFocused, setIsTimeFocused] = useState(false);
  const [localTime, setLocalTime] = useState("");
  const timeOriginalRef = useRef("");
  const dateRef = useRef<HTMLInputElement>(null);
  const tzRef = useRef<HTMLDivElement>(null);

  const search = tzSearch.toLowerCase();
  const filteredTimezones = useMemo(() => {
    const matches = (s: string) =>
      s.toLowerCase().includes(search) || s.toLowerCase().replace(/_/g, " ").includes(search);
    const curated = WORKING_TIMEZONES.filter(
      (tz) => tz.name.toLowerCase().includes(search) || matches(tz.value)
    );
    const curatedValues = new Set(WORKING_TIMEZONES.map((tz) => tz.value));
    const extraIana = search
      ? Intl.supportedValuesOf("timeZone")
          .filter((tz) => !curatedValues.has(tz) && matches(tz))
          .map((tz) => ({ value: tz, name: tz }))
      : [];
    return [...curated, ...extraIana];
  }, [search]);

  // A zone's UTC offset depends on the date, so labels are resolved against the
  // capture dates actually in the selection rather than baked into the list.
  const captureDates = useMemo(() => distinctCaptureDates(selectedPhotos), [selectedPhotos]);
  const zoneOffsets = useMemo(() => {
    const zones = filteredTimezones.map((tz) => tz.value);
    if (timezone && timezone !== "multiple") zones.push(timezone);
    return resolveZoneOffsets(zones, captureDates);
  }, [filteredTimezones, captureDates, timezone]);

  /** "US Mountain · MDT UTC−6", or a bare name when no single offset applies. */
  const zoneLabelFor = (value: string, name: string) => {
    const resolved = zoneOffsets.get(value);
    return resolved ? `${name} · ${formatZoneOffset(resolved)}` : name;
  };

  // Explain the bare rows when a selection straddles a DST transition.
  const offsetsHidden =
    captureDates.length > 0 && filteredTimezones.some((tz) => !zoneOffsets.get(tz.value));

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

  /**
   * Per-photo edits that differ only in a few fields persist in groups of
   * identical payloads, keeping the common case a single backend call.
   */
  function persistGrouped(updates: Array<{ id: string; changes: Partial<Metadata> }>) {
    const groups = new Map<string, { ids: string[]; changes: Partial<Metadata> }>();
    for (const u of updates) {
      const key = JSON.stringify(u.changes);
      const group = groups.get(key);
      if (group) group.ids.push(u.id);
      else groups.set(key, { ids: [u.id], changes: u.changes });
    }
    for (const group of groups.values()) persistPending(group.ids, group.changes);
  }

  // The stored offset is not set here: the session reducer derives it from the
  // resulting date, time, and zone for every edit, whatever control made it.
  function dispatchChanges(changes: Partial<Metadata>) {
    dispatch({ type: "SET_PENDING", ids: selectedIds, changes });
    persistPending(selectedIds, changes);
  }

  function maybeConfirm(
    currentValue: unknown,
    getValue: (m: Metadata) => unknown,
    changes: Partial<Metadata>
  ) {
    if (currentValue === "multiple") {
      const count = new Set(selectedPhotos.map((p) => getValue(p.currentMetadata))).size;
      setPendingConfirm({ count, proceed: () => dispatchChanges(changes) });
    } else {
      dispatchChanges(changes);
    }
  }

  function handleDateFocus() {
    try { dateRef.current?.showPicker(); } catch (_) {}
  }

  /** Enter commits: every field saves on blur, so blurring is the commit. */
  function blurOnEnter(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur();
    }
  }

  function handleDateChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    if (!value) return;
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

  function handleTimezoneKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const first = filteredTimezones[0];
    if (tzOpen && first) handleTimezoneSelect(first.value);
    e.currentTarget.blur();
  }

  function handleTimezoneBlur() {
    setTzOpen(false);
    setTzSearch("");
  }

  function handleTimezoneSelect(tz: string) {
    setTzOpen(false);
    setTzSearch("");
    if (timezone === "multiple") {
      const count = new Set(selectedPhotos.map((p) => p.currentMetadata.timezone)).size;
      setPendingConfirm({ count, proceed: () => beginTimezoneChange(tz) });
    } else {
      beginTimezoneChange(tz);
    }
  }

  /** The zone's offset at a photo's own capture instant, null when unresolvable. */
  function zoneOffsetForPhoto(photo: Photo, tz: string): string | null {
    const { captureDate: cd, captureTime: ct } = photo.currentMetadata;
    return cd ? utcOffsetFor(cd, ct, tz) : null;
  }

  /**
   * A photo disagrees with the chosen zone when it carries an offset and the
   * zone resolves to a different one at that photo's capture instant. Photos
   * with no offset have nothing to disagree with and are relabelled silently.
   */
  function beginTimezoneChange(tz: string) {
    const mismatched = selectedPhotos.filter((p) => {
      const off = p.currentMetadata.utcOffset;
      if (!off) return false;
      const next = zoneOffsetForPhoto(p, tz);
      return next !== null && offsetToMinutes(next) !== offsetToMinutes(off);
    });

    if (mismatched.length === 0) {
      applyTimezone(selectedPhotos, tz, "keep");
      return;
    }

    const uniqueLabel = (values: Array<string | null>) => {
      const set = new Set(values);
      if (set.size !== 1) return null;
      const only = [...set][0];
      return only ? formatUtcOffset(only) : null;
    };
    const zoneOffsetLabel = uniqueLabel(mismatched.map((p) => zoneOffsetForPhoto(p, tz)));
    const currentOffsetLabel = uniqueLabel(mismatched.map((p) => p.currentMetadata.utcOffset));

    let sampleCurrentTime: string | null = null;
    let sampleAdjustedTime: string | null = null;
    if (mismatched.length === 1) {
      const m = mismatched[0].currentMetadata;
      if (m.captureDate && m.captureTime && m.utcOffset) {
        const shifted = wallClockInZone(m.captureDate, m.captureTime, m.utcOffset, tz);
        if (shifted) {
          sampleCurrentTime = formatTimeDisplay(m.captureTime);
          sampleAdjustedTime = formatTimeDisplay(shifted.time);
        }
      }
    }

    const option = WORKING_TIMEZONES.find((t) => t.value === tz);
    setTzMismatchMode("adjust");
    setTzMismatch({
      tz,
      tzName: option ? option.name : tz,
      photos: selectedPhotos,
      mismatchCount: mismatched.length,
      zoneOffsetLabel,
      currentOffsetLabel,
      sampleCurrentTime,
      sampleAdjustedTime,
    });
  }

  /**
   * Set the zone on every selected photo, refreshing each photo's offset to the
   * zone's value at its capture instant. "adjust" re-expresses the wall clock in
   * the new zone so the moment of capture is preserved; "keep" leaves the wall
   * clock alone, letting the moment shift by the offset difference.
   */
  function applyTimezone(photos: Photo[], tz: string, mode: "adjust" | "keep") {
    const updates: Array<{ id: string; changes: Partial<Metadata> }> = [];
    for (const photo of photos) {
      const { captureDate: cd, captureTime: ct, utcOffset: off } = photo.currentMetadata;
      // A photo with no date has no instant to resolve the zone at, so its
      // offset is null until a date arrives and the reducer derives it.
      const next = zoneOffsetForPhoto(photo, tz);
      const changes: Partial<Metadata> = { timezone: tz, utcOffset: next };
      if (
        mode === "adjust" &&
        next &&
        cd &&
        ct &&
        off &&
        offsetToMinutes(off) !== offsetToMinutes(next)
      ) {
        const shifted = wallClockInZone(cd, ct, off, tz);
        if (shifted) {
          changes.captureDate = shifted.date;
          changes.captureTime = shifted.time;
        }
      }
      updates.push({ id: photo.id, changes });
    }

    dispatch({ type: "SET_PENDING_BATCH", updates });
    persistGrouped(updates);
  }

  function handleIncrement(direction: 1 | -1) {
    for (const photo of selectedPhotos) {
      const { captureDate: cd, captureTime: ct, timezone: tz } = photo.currentMetadata;
      if (!cd || !ct) continue;
      // Shift within the photo's own zone: day rollover and DST transitions both
      // fall out of the zone arithmetic instead of being hand-rolled.
      const shifted = shiftWallClock(cd, ct, tz, direction * incrementHours);
      if (!shifted) continue;
      const changes = { captureDate: shifted.date, captureTime: shifted.time };
      dispatch({ type: "SET_PENDING", ids: [photo.id], changes });
      persistPending([photo.id], changes);
    }
  }

  const incrementEnabled =
    selectedPhotos.length > 0 &&
    selectedPhotos.every(
      (p) => p.currentMetadata.captureDate && p.currentMetadata.captureTime
    );

  const isEmpty = selectedPhotos.length === 0;

  const dateValue = captureDate && captureDate !== "multiple" ? captureDate : "";


  const timeRaw =
    captureTime && captureTime !== "multiple"
      ? formatTimeDisplay(captureTime)
      : "";

  const hasMixedTimezones = timezone === "multiple";
  const tzOption = WORKING_TIMEZONES.find((tz) => tz.value === timezone);
  const tzDisplayValue =
    timezone && !hasMixedTimezones
      ? zoneLabelFor(timezone, tzOption ? tzOption.name : timezone)
      : "";
  const tzPlaceholder = hasMixedTimezones ? "Multiple Values" : "Not set";

  // The offset shown is the selected zone's (resolved at the capture dates)
  // once a timezone is set; otherwise it falls back to the camera-recorded
  // value, labelled as such so an unresolved timezone stays visible as open.
  const recordedOffset = deriveFieldValue(selectedPhotos, (m) => m.utcOffset);
  let offsetLabel = "—";
  let offsetSource: string | null = null;
  if (hasMixedTimezones) {
    offsetLabel = "Multiple Values";
  } else if (timezone) {
    const resolved = zoneOffsets.get(timezone);
    offsetLabel = resolved ? resolved.offset : captureDates.length > 0 ? "Varies" : "—";
    offsetSource = "from selected timezone";
  } else if (recordedOffset === "multiple") {
    offsetLabel = "Multiple Values";
  } else if (recordedOffset) {
    offsetLabel = formatUtcOffset(recordedOffset) ?? recordedOffset;
    offsetSource = "from camera";
  }

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
                  ref={dateRef}
                  type="date"
                  className={`input ${styles.dateInput} ${!dateValue && captureDate !== "multiple" ? styles.dateInputEmpty : ""}`}
                  value={dateValue}
                  placeholder={captureDate === "multiple" ? "Multiple Values" : undefined}
                  onFocus={handleDateFocus}
                  onChange={handleDateChange}
                  onBlur={handleDateBlur}
                  onKeyDown={blurOnEnter}
                />
                {!dateValue && captureDate !== "multiple" && (
                  <span className={styles.dateOverlay}>--/--/----</span>
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
                onKeyDown={blurOnEnter}
              />
            </div>
            <div className={`${styles.row} ${styles.tzRow}`}>
              <span className={styles.label}>Timezone</span>
              <div ref={tzRef} className={styles.tzWrapper}>
                <input
                  type="text"
                  className={`input ${styles.tzInput} ${hasMixedTimezones ? styles.tzInputWarning : ""}`}
                  value={tzOpen ? tzSearch : tzDisplayValue}
                  placeholder={tzPlaceholder}
                  onFocus={() => { setTzOpen(true); setTzSearch(""); }}
                  onChange={(e) => setTzSearch(e.target.value)}
                  onKeyDown={handleTimezoneKeyDown}
                  onBlur={handleTimezoneBlur}
                  readOnly={!tzOpen}
                  autoComplete="off"
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
                        {zoneLabelFor(tz.value, tz.name)}
                      </button>
                    ))}
                    {filteredTimezones.length === 0 && (
                      <p className={styles.tzNoMatch}>No timezones match</p>
                    )}
                    {offsetsHidden && filteredTimezones.length > 0 && (
                      <p className={styles.tzNote}>
                        Some offsets hidden — selection spans a daylight saving change
                      </p>
                    )}
                  </div>
                )}
                {hasMixedTimezones && !tzOpen && (
                  <p className={styles.tzWarning}>Selection contains multiple timezones</p>
                )}
              </div>
            </div>
            <div className={styles.row}>
              <span className={styles.label}>Offset</span>
              <div className={styles.offsetValue}>
                <span>{offsetLabel}</span>
                {offsetSource && <span className={styles.offsetSource}>{offsetSource}</span>}
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
                onKeyDown={blurOnEnter}
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
            pendingConfirm.proceed();
            setPendingConfirm(null);
          }}
          onCancel={() => setPendingConfirm(null)}
        />
      )}

      {tzMismatch && (
        <ConfirmDialog
          title="Timezone Changes UTC Offset"
          message={
            <>
              {tzMismatch.zoneOffsetLabel && tzMismatch.currentOffsetLabel ? (
                <>
                  <strong>{tzMismatch.tzName}</strong> is{" "}
                  <strong>{tzMismatch.zoneOffsetLabel}</strong> at the time of capture, but{" "}
                  {tzMismatch.mismatchCount === 1 ? (
                    <>this photo records <strong>{tzMismatch.currentOffsetLabel}</strong></>
                  ) : (
                    <>
                      <strong>{tzMismatch.mismatchCount}</strong> photos record{" "}
                      <strong>{tzMismatch.currentOffsetLabel}</strong>
                    </>
                  )}
                  .
                </>
              ) : (
                <>
                  <strong>{tzMismatch.tzName}</strong> has a different UTC offset than{" "}
                  <strong>{tzMismatch.mismatchCount}</strong>{" "}
                  {tzMismatch.mismatchCount === 1 ? "photo" : "photos"} currently record.
                </>
              )}{" "}
              Do you want to adjust the capture{" "}
              {tzMismatch.mismatchCount === 1 ? "time" : "times"} by this offset?
            </>
          }
          onConfirm={() => {
            applyTimezone(tzMismatch.photos, tzMismatch.tz, tzMismatchMode);
            setTzMismatch(null);
          }}
          onCancel={() => setTzMismatch(null)}
        >
          <div className={styles.tzModeGroup}>
            <label className={styles.tzModeOption}>
              <input
                type="radio"
                name="tzMismatchMode"
                checked={tzMismatchMode === "adjust"}
                onChange={() => setTzMismatchMode("adjust")}
              />
              <span>
                Adjust capture {tzMismatch.mismatchCount === 1 ? "time" : "times"}
                {tzMismatch.sampleCurrentTime && tzMismatch.sampleAdjustedTime && (
                  <> (from {tzMismatch.sampleCurrentTime} to {tzMismatch.sampleAdjustedTime})</>
                )}
              </span>
            </label>
            <label className={styles.tzModeOption}>
              <input
                type="radio"
                name="tzMismatchMode"
                checked={tzMismatchMode === "keep"}
                onChange={() => setTzMismatchMode("keep")}
              />
              <span>Keep capture {tzMismatch.mismatchCount === 1 ? "time" : "times"}</span>
            </label>
          </div>
        </ConfirmDialog>
      )}
    </div>
  );
}
