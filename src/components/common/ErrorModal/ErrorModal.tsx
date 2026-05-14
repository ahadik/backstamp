import { useState } from "react";
import { useUI } from "../../../state/UIContext";
import styles from "./ErrorModal.module.css";

export function ErrorModal() {
  const { state, dispatch } = useUI();
  const [copied, setCopied] = useState(false);

  if (!state.error) return null;

  function dismiss() {
    dispatch({ type: "SET_ERROR", error: null });
    setCopied(false);
  }

  async function copyToClipboard() {
    await navigator.clipboard.writeText(state.error!);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className={styles.backdrop} onClick={dismiss}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>Error</span>
          <button className={styles.copyBtn} onClick={copyToClipboard}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <pre className={styles.message}>{state.error}</pre>
        <div className={styles.actions}>
          <button className="btn" onClick={dismiss}>Dismiss</button>
        </div>
      </div>
    </div>
  );
}
