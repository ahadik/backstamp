import React, { useState, useEffect, useRef } from "react";
import { useSession } from "../../../state/SessionContext";
import { useUI } from "../../../state/UIContext";
import { deriveFieldValue } from "../../../lib/inspectorUtils";
import { runVibeTag } from "../../../lib/vibeTag";
import { tauriCommands } from "../../../lib/tauri";
import type { Photo, Metadata } from "../../../state/SessionContext";
import type { MetadataProposal, VibeTagMessage, VibeTagDevData } from "../../../lib/vibeTag";
import styles from "./VibeTagSection.module.css";

interface VibeTagSectionProps {
  selectedPhotos: Photo[];
  onOpenSettings: () => void;
}

function buildMetadataSummary(photos: Photo[]): object {
  return {
    capture_date: deriveFieldValue(photos, (m) => m.captureDate) ?? "unset",
    capture_time: deriveFieldValue(photos, (m) => m.captureTime) ?? "unset",
    timezone: deriveFieldValue(photos, (m) => m.timezone) ?? "unset",
    camera_make: deriveFieldValue(photos, (m) => m.cameraMake) ?? "unset",
    camera_model: deriveFieldValue(photos, (m) => m.cameraModel) ?? "unset",
    lens: deriveFieldValue(photos, (m) => m.lens) ?? "unset",
    film_vendor: deriveFieldValue(photos, (m) => m.filmVendor) ?? "unset",
    film_type: deriveFieldValue(photos, (m) => m.filmType) ?? "unset",
    gps:
      deriveFieldValue(
        photos,
        (m) =>
          m.gpsLat !== null && m.gpsLng !== null
            ? `${m.gpsLat}, ${m.gpsLng}`
            : null
      ) ?? "unset",
  };
}

function proposalToChanges(proposal: MetadataProposal): Partial<Metadata> {
  const changes: Partial<Metadata> = {};
  if (proposal.capture_date !== undefined) changes.captureDate = proposal.capture_date;
  if (proposal.capture_time !== undefined) changes.captureTime = proposal.capture_time;
  if (proposal.timezone !== undefined) changes.timezone = proposal.timezone;
  if (proposal.camera_make !== undefined) changes.cameraMake = proposal.camera_make || null;
  if (proposal.camera_model !== undefined) changes.cameraModel = proposal.camera_model || null;
  if (proposal.lens !== undefined) changes.lens = proposal.lens;
  if (proposal.film !== undefined) {
    changes.filmVendor = proposal.film.vendor || null;
    changes.filmType = proposal.film.type || null;
  }
  if (proposal.location !== undefined) {
    changes.gpsLat = proposal.location.lat;
    changes.gpsLng = proposal.location.lng;
  }
  return changes;
}

function formatProposal(proposal: MetadataProposal): string {
  const lines: string[] = [];
  if (proposal.capture_date) lines.push(`Date: ${proposal.capture_date}`);
  if (proposal.capture_time) lines.push(`Time: ${proposal.capture_time}`);
  if (proposal.timezone) lines.push(`Timezone: ${proposal.timezone}`);
  if (proposal.camera_make) lines.push(`Make: ${proposal.camera_make}`);
  if (proposal.camera_model) lines.push(`Model: ${proposal.camera_model}`);
  if (proposal.lens) lines.push(`Lens: ${proposal.lens}`);
  if (proposal.film) lines.push(`Film: ${[proposal.film.vendor, proposal.film.type].filter(Boolean).join(" ")}`);
  if (proposal.location)
    lines.push(`Location: ${proposal.location.display_name}`);
  return lines.join("\n");
}

export function VibeTagSection({
  selectedPhotos,
  onOpenSettings,
}: VibeTagSectionProps) {
  const { dispatch, state } = useSession();
  const { state: uiState } = useUI();
  const claudeApiKey = uiState.claudeApiKey;
  const mapboxToken = uiState.mapboxToken;

  const [messages, setMessages] = useState<VibeTagMessage[]>([]);
  const [proposal, setProposal] = useState<MetadataProposal | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputText, setInputText] = useState("");
  const [devData, setDevData] = useState<VibeTagDevData | null>(null);
  const [devOpen, setDevOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Clear conversation when selection changes
  useEffect(() => {
    setMessages([]);
    setProposal(null);
    setError(null);
    setInputText("");
    setDevData(null);
    setDevOpen(false);
  }, [state.selectedIds]);

  async function handleSubmit() {
    const text = inputText.trim();
    if (!text || loading || !claudeApiKey) return;

    const newMessage: VibeTagMessage = { role: "user", content: text };
    const updatedMessages = [...messages, newMessage];
    setMessages(updatedMessages);
    setInputText("");
    setLoading(true);
    setError(null);
    setProposal(null);

    try {
      const summary = buildMetadataSummary(selectedPhotos);
      const { proposal: result, devData: newDevData } = await runVibeTag(
        claudeApiKey,
        updatedMessages,
        selectedPhotos.length,
        summary,
        mapboxToken
      );
      setProposal(result);
      if (import.meta.env.DEV) setDevData(newDevData);
      setMessages([
        ...updatedMessages,
        { role: "assistant", content: JSON.stringify(result) },
      ]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }

  function handleAccept() {
    if (!proposal) return;
    const changes = proposalToChanges(proposal);
    const ids = selectedPhotos.map((p) => p.id);
    dispatch({ type: "SET_PENDING", ids, changes });
    const fields = Object.entries(changes).map(([field, value]) => ({
      field,
      value: value == null ? null : String(value),
    }));
    tauriCommands.setPendingChanges(ids, fields).catch(console.error);
    setProposal(null);
    setMessages([]);
  }

  function handleFollowUp() {
    setProposal(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  const isEmpty = selectedPhotos.length === 0;

  if (!claudeApiKey) {
    return (
      <div className={styles.section}>
        <div className="section-label">Vibe Tag</div>
        <div className={`inspector-card ${styles.card}`}>
          <p className={styles.noKey}>A Claude API key is required for Vibe Tag.</p>
          <button className="btn btn-low btn-secondary" onClick={onOpenSettings}>
            Open Settings
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <div className="section-label">Vibe Tag</div>
      <div className={`inspector-card ${styles.card}`}>
        {isEmpty ? (
          <p className={styles.empty}>Select photos to use Vibe Tag</p>
        ) : (
          <>
            {proposal && (
              <div className={styles.proposal}>
                <p className={styles.proposalText}>{formatProposal(proposal)}</p>
                <div className={styles.proposalActions}>
                  <button className="btn btn-low btn-primary" onClick={handleAccept}>
                    Accept
                  </button>
                  <button className="btn btn-low btn-glass" onClick={handleFollowUp}>
                    Follow Up
                  </button>
                </div>
              </div>
            )}

            {error && <p className={styles.error}>{error}</p>}

            <div className={styles.inputRow}>
              <textarea
                ref={inputRef}
                className={`input ${styles.chatInput}`}
                placeholder={
                  loading
                    ? "Thinking…"
                    : "Describe the metadata (e.g. 'taken at noon in Paris')"
                }
                value={inputText}
                disabled={loading}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              <button
                className={`btn btn-low btn-primary ${styles.sendBtn}`}
                disabled={loading || !inputText.trim()}
                onClick={handleSubmit}
              >
                {loading ? <span className={styles.spinner} /> : "Tag It"}
              </button>
            </div>
          </>
        )}

        {import.meta.env.DEV && devData && (
          <div className={styles.devSection}>
            <button
              className={styles.devToggle}
              onClick={() => setDevOpen((v) => !v)}
            >
              Raw response {devOpen ? "▾" : "▸"}
            </button>
            {devOpen && (
              <pre className={styles.devContent}>
                {JSON.stringify(devData.rawResponses, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
