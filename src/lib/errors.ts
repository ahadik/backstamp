// User-visible reporting for backend command failures (issue #8).
//
// In a production build there is no console and no DevLog, so a rejected Tauri
// command that is merely `console.error`ed is invisible: the UI keeps showing
// an optimistic update that was never persisted. Fire-and-forget call sites
// route rejections through reportError instead; UIProvider registers a handler
// that surfaces the message in the ErrorModal. Messages also always go to
// console.error, so the DevLog still captures them in dev builds.

export function formatErrorMessage(err: unknown): string {
  // Tauri commands reject with plain strings from the Rust side.
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

type ErrorHandler = (message: string) => void;

let handler: ErrorHandler | null = null;

export function setErrorHandler(next: ErrorHandler | null): void {
  handler = next;
}

/**
 * Report a failed backend call to the user. `context` should describe the
 * consequence in user terms (e.g. "Failed to save date/time edits"), since the
 * raw error is appended below it.
 */
export function reportError(context: string, err: unknown): void {
  console.error(`${context}:`, err);
  handler?.(`${context}\n\n${formatErrorMessage(err)}`);
}
