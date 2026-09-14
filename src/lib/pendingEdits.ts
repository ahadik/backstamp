import { tauriCommands } from "./tauri";
import { reportError } from "./errors";
import type { Metadata } from "../state/SessionContext";

/**
 * Persist a batch of per-photo pending changes to the backend. Changes can
 * differ per photo (e.g. timezones vary across a selection), so they're
 * grouped by identical payloads to keep the common case a single call.
 */
export function persistPendingUpdates(
  updates: Array<{ id: string; changes: Partial<Metadata> }>,
  errorMessage: string
) {
  const groups = new Map<string, { ids: string[]; changes: Partial<Metadata> }>();
  for (const u of updates) {
    const key = JSON.stringify(u.changes);
    const group = groups.get(key);
    if (group) group.ids.push(u.id);
    else groups.set(key, { ids: [u.id], changes: u.changes });
  }
  for (const group of groups.values()) {
    const fields = Object.entries(group.changes).map(([field, value]) => ({
      field,
      value: value == null ? null : String(value),
    }));
    tauriCommands
      .setPendingChanges(group.ids, fields)
      .catch((err) => reportError(errorMessage, err));
  }
}
