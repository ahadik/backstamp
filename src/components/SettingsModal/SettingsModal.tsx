import { useEffect, useState } from "react";
import { useUI } from "../../state/UIContext";
import { tauriCommands } from "../../lib/tauri";
import styles from "./SettingsModal.module.css";

interface SettingsModalProps {
  onClose: () => void;
}

type TestState = "idle" | "testing" | "ok" | "fail";

function maskKey(key: string): string {
  if (key.length <= 8) return key.slice(0, 2) + "••••••";
  return key.slice(0, 6) + "••••••••••••" + key.slice(-4);
}

function makeKeyTester(account: string) {
  return (key: string) => tauriCommands.testApiKey(account, key).catch(() => false);
}

const testAnthropicKey = makeKeyTester("claude_api_key");
const testMapboxKey = makeKeyTester("mapbox_token");
const testGoogleMapsKey = makeKeyTester("google_maps_key");

interface KeyFieldProps {
  label: string;
  hint: string;
  placeholder: string;
  savedValue: string | null;
  settingKey: string;
  onTest: (key: string) => Promise<boolean>;
  onSaved: (value: string | null) => void;
}

function KeyField({
  label,
  hint,
  placeholder,
  savedValue,
  settingKey,
  onTest,
  onSaved,
}: KeyFieldProps) {
  const [value, setValue] = useState(savedValue ?? "");
  const [isDirty, setIsDirty] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [testState, setTestState] = useState<TestState>("idle");

  async function handleBlur() {
    if (!isDirty) return;
    const trimmed = value.trim();
    if (trimmed) {
      onSaved(trimmed);
      tauriCommands.setApiKey(settingKey, trimmed).catch(console.error);
    } else {
      // User cleared the field — revert display without removing the saved key
      setValue(savedValue ?? "");
    }
    setIsDirty(false);
  }

  async function handleRemove() {
    await tauriCommands.deleteApiKey(settingKey);
    setValue("");
    setIsDirty(false);
    setTestState("idle");
    onSaved(null);
  }

  async function handleTest() {
    const key = isDirty ? value.trim() : (savedValue ?? "");
    if (!key) return;
    setTestState("testing");
    const ok = await onTest(key);
    setTestState(ok ? "ok" : "fail");
  }

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>{label}</h3>
        {testState === "ok" && <span className={styles.badgeOk}>✓ Valid</span>}
        {testState === "fail" && <span className={styles.badgeFail}>✗ Invalid</span>}
      </div>
      <p className={styles.hint}>{hint}</p>
      {savedValue && !isDirty && (
        <p className={styles.currentKey}>{maskKey(savedValue)}</p>
      )}
      <div className={styles.inputRow}>
        <input
          type={showKey ? "text" : "password"}
          className={`input ${styles.keyInput}`}
          value={isDirty ? value : (showKey ? (savedValue ?? "") : "")}
          placeholder={savedValue && !isDirty ? "Enter new key to replace…" : placeholder}
          onChange={(e) => {
            setValue(e.target.value);
            setIsDirty(true);
            setTestState("idle");
          }}
          onFocus={(e) => {
            if (!isDirty && savedValue) {
              setValue(savedValue);
              setIsDirty(true);
              // Select all so typing immediately replaces the key
              setTimeout(() => e.target.select(), 0);
            }
          }}
          onBlur={handleBlur}
          autoComplete="off"
          spellCheck={false}
        />
        <button
          className="btn btn-glass"
          type="button"
          onClick={() => setShowKey((s) => !s)}
          aria-label={showKey ? "Hide key" : "Show key"}
        >
          {showKey ? "Hide" : "Show"}
        </button>
        <button
          className="btn btn-glass"
          type="button"
          disabled={testState === "testing" || (!isDirty && !savedValue)}
          onClick={handleTest}
        >
          {testState === "testing" ? "Testing…" : "Test"}
        </button>
        {savedValue && !isDirty && (
          <button className="btn btn-danger" type="button" onClick={handleRemove}>
            Remove
          </button>
        )}
      </div>
    </section>
  );
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const { state, dispatch } = useUI();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Settings</h2>
          <button
            className="btn btn-glass"
            onClick={onClose}
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        <div className={styles.body}>
          <KeyField
            label="Mapbox API Key"
            hint="Required for the location map and GPX route thumbnails. Also used as fallback for location search when no Google Maps key is set."
            placeholder="pk.eyJ1Ijoi…"
            savedValue={state.mapboxToken}
            settingKey="mapbox_token"
            onTest={testMapboxKey}
            onSaved={(val) => dispatch({ type: "SET_MAPBOX_TOKEN", token: val })}
          />
          <hr className="divider" />
          <KeyField
            label="Google Maps API Key"
            hint="Optional. When set, used for location search and geocoding instead of Mapbox. Map rendering always uses Mapbox."
            placeholder="AIza…"
            savedValue={state.googleMapsKey}
            settingKey="google_maps_key"
            onTest={testGoogleMapsKey}
            onSaved={(val) => dispatch({ type: "SET_GOOGLE_MAPS_KEY", key: val })}
          />
          <hr className="divider" />
          <KeyField
            label="Anthropic API Key"
            hint="Required for Vibe Tag natural-language metadata entry."
            placeholder="sk-ant-…"
            savedValue={state.claudeApiKey}
            settingKey="claude_api_key"
            onTest={testAnthropicKey}
            onSaved={(val) => dispatch({ type: "SET_CLAUDE_API_KEY", key: val })}
          />
        </div>
        <div className={styles.footer}>
          <button className="btn btn-primary" onClick={onClose}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
