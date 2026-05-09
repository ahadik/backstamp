import React, { useState, useRef, useEffect } from "react";
import type { CorpusEntry } from "../../../state/CorpusContext";
import styles from "./CorpusComboBox.module.css";

interface CorpusComboBoxProps {
  label: string;
  value: string | "multiple" | null;
  entries: CorpusEntry[];
  onSelect: (value: string) => void;
  onAddEntry: (value: string) => void;
  onRemoveEntry: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

function normalize(s: string): string {
  return s.normalize("NFC").toLowerCase().trim();
}

export function CorpusComboBox({
  label,
  value,
  entries,
  onSelect,
  onAddEntry,
  onRemoveEntry,
  placeholder,
  disabled = false,
}: CorpusComboBoxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [removeConfirm, setRemoveConfirm] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  const displayValue =
    value === "multiple" ? "" : (value ?? "");
  const inputPlaceholder =
    value === "multiple"
      ? "Multiple Values"
      : placeholder ?? label;

  const searchKey = normalize(search);

  const filtered =
    search.trim() === ""
      ? entries
      : entries.filter((e) => normalize(e.value).includes(searchKey));

  const exactMatch = entries.some((e) => normalize(e.value) === searchKey);
  const showAddOption = search.trim() !== "" && !exactMatch;

  const valueNotInCorpus =
    value && value !== "multiple" && !entries.some((e) => normalize(e.value) === normalize(value));

  function handleOpen() {
    if (disabled) return;
    setOpen(true);
    setSearch("");
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function handleSelect(v: string) {
    setOpen(false);
    setSearch("");
    onSelect(v);
  }

  function handleAdd() {
    const trimmed = search.trim();
    if (!trimmed) return;
    onAddEntry(trimmed);
    onSelect(trimmed);
    setOpen(false);
    setSearch("");
  }

  function handleAddExisting() {
    if (!value || value === "multiple") return;
    onAddEntry(value);
    setOpen(false);
    setSearch("");
  }

  function handleRemoveClick(e: React.MouseEvent, v: string) {
    e.stopPropagation();
    setRemoveConfirm(v);
  }

  function handleRemoveConfirm() {
    if (removeConfirm) {
      onRemoveEntry(removeConfirm);
      setRemoveConfirm(null);
    }
  }

  return (
    <div ref={wrapperRef} className={`${styles.wrapper} ${disabled ? styles.disabled : ""}`}>
      <span className={styles.fieldLabel}>{label}</span>
      <div className={styles.inputRow}>
        <input
          ref={inputRef}
          type="text"
          className={`input ${styles.input} ${valueNotInCorpus ? styles.italic : ""}`}
          value={open ? search : displayValue}
          placeholder={inputPlaceholder}
          onFocus={handleOpen}
          onChange={(e) => setSearch(e.target.value)}
          readOnly={!open}
          disabled={disabled}
        />
        <span className={styles.caret} onClick={handleOpen} aria-hidden>
          ▾
        </span>
      </div>

      {open && (
        <div className={styles.dropdown}>
          {showAddOption && (
            <button
              className={`${styles.option} ${styles.addOption}`}
              onMouseDown={(e) => { e.preventDefault(); handleAdd(); }}
            >
              Add &ldquo;{search.trim()}&rdquo;
            </button>
          )}
          {valueNotInCorpus && !open && (
            <button
              className={`${styles.option} ${styles.addOption}`}
              onMouseDown={(e) => { e.preventDefault(); handleAddExisting(); }}
            >
              Add &ldquo;{value}&rdquo; to list
            </button>
          )}
          {valueNotInCorpus && open && search === "" && (
            <button
              className={`${styles.option} ${styles.addOption}`}
              onMouseDown={(e) => { e.preventDefault(); handleAddExisting(); }}
            >
              Add &ldquo;{value}&rdquo; to list
            </button>
          )}
          {filtered.length > 0 && showAddOption && (
            <div className={styles.divider} />
          )}
          {filtered.map((entry) => (
            <div
              key={entry.value}
              className={`${styles.option} ${styles.entryRow}`}
              onMouseDown={(e) => { e.preventDefault(); handleSelect(entry.value); }}
            >
              <span className={styles.entryValue}>{entry.value}</span>
              {!entry.isBuiltin && (
                <button
                  className={styles.removeBtn}
                  title={`Remove "${entry.value}"`}
                  onMouseDown={(e) => { e.preventDefault(); handleRemoveClick(e, entry.value); }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          {filtered.length === 0 && !showAddOption && (
            <p className={styles.noMatch}>No options match</p>
          )}
        </div>
      )}

      {removeConfirm && (
        <div className={styles.removeConfirm}>
          <p className={styles.removeMsg}>
            Remove <strong>&ldquo;{removeConfirm}&rdquo;</strong> from the list? Photos already
            tagged with this value are not affected.
          </p>
          <div className={styles.removeActions}>
            <button
              className="btn btn-glass"
              onMouseDown={(e) => { e.preventDefault(); setRemoveConfirm(null); }}
            >
              Cancel
            </button>
            <button
              className="btn btn-danger"
              onMouseDown={(e) => { e.preventDefault(); handleRemoveConfirm(); }}
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
