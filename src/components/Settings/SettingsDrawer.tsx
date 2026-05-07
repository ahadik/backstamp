import { useState } from "react";
import { useUI } from "../../state/UIContext";
import { tauriCommands } from "../../lib/tauri";
import styles from "./SettingsDrawer.module.css";

interface SettingsDrawerProps {
  onClose: () => void;
}

function maskKey(key: string): string {
  if (key.length <= 8) return "••••••••";
  return "••••••••" + key.slice(-8);
}

export function SettingsDrawer({ onClose }: SettingsDrawerProps) {
  const { state, dispatch } = useUI();

  const [mapboxInput, setMapboxInput] = useState(state.mapboxToken ?? "");
  const [claudeInput, setClaudeInput] = useState(state.claudeApiKey ?? "");
  const [mapboxSaved, setMapboxSaved] = useState(false);
  const [claudeSaved, setClaudeSaved] = useState(false);

  async function saveMapbox() {
    const val = mapboxInput.trim();
    await tauriCommands.setSetting("mapbox_token", val);
    dispatch({ type: "SET_MAPBOX_TOKEN", token: val || null });
    setMapboxSaved(true);
    setTimeout(() => setMapboxSaved(false), 2000);
  }

  async function saveClaude() {
    const val = claudeInput.trim();
    await tauriCommands.setSetting("claude_api_key", val);
    dispatch({ type: "SET_CLAUDE_API_KEY", key: val || null });
    setClaudeSaved(true);
    setTimeout(() => setClaudeSaved(false), 2000);
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.drawer} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Settings</h2>
          <button className="btn btn-glass" onClick={onClose} aria-label="Close settings">
            ✕
          </button>
        </div>

        <div className={styles.body}>
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Mapbox API Key</h3>
            <p className={styles.hint}>
              Required for the location map and place search.{" "}
              {state.mapboxToken && (
                <span className={styles.saved}>Currently saved: {maskKey(state.mapboxToken)}</span>
              )}
            </p>
            <div className={styles.inputRow}>
              <input
                type="password"
                className="input"
                value={mapboxInput}
                placeholder="pk.eyJ1Ijoi…"
                onChange={(e) => setMapboxInput(e.target.value)}
              />
              <button className="btn btn-primary" onClick={saveMapbox}>
                {mapboxSaved ? "Saved ✓" : "Save"}
              </button>
            </div>
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Claude API Key</h3>
            <p className={styles.hint}>
              Required for Vibe Tag natural-language metadata entry.{" "}
              {state.claudeApiKey && (
                <span className={styles.saved}>Currently saved: {maskKey(state.claudeApiKey)}</span>
              )}
            </p>
            <div className={styles.inputRow}>
              <input
                type="password"
                className="input"
                value={claudeInput}
                placeholder="sk-ant-…"
                onChange={(e) => setClaudeInput(e.target.value)}
              />
              <button className="btn btn-primary" onClick={saveClaude}>
                {claudeSaved ? "Saved ✓" : "Save"}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
