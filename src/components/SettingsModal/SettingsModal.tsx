import { useEffect, useState } from "react";
import Anthropic from "@anthropic-ai/sdk";
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

async function testAnthropicKey(key: string): Promise<boolean> {
  try {
    const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
    await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    });
    return true;
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return false;
    // Non-auth errors (rate limit, model error, etc.) still mean the key is valid
    return true;
  }
}

async function testMapboxKey(key: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/test.json?access_token=${encodeURIComponent(key)}&limit=1`
    );
    return res.status === 200;
  } catch {
    return false;
  }
}

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
      tauriCommands.setSetting(settingKey, trimmed).catch(console.error);
    } else {
      // User cleared the field — revert display without removing the saved key
      setValue(savedValue ?? "");
    }
    setIsDirty(false);
  }

  async function handleRemove() {
    await tauriCommands.setSetting(settingKey, "");
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
            hint="Required for the location map, place search, and GPX route thumbnails."
            placeholder="pk.eyJ1Ijoi…"
            savedValue={state.mapboxToken}
            settingKey="mapbox_token"
            onTest={testMapboxKey}
            onSaved={(val) => dispatch({ type: "SET_MAPBOX_TOKEN", token: val })}
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
