import { useState } from "react";
import { useUI } from "../../../state/UIContext";
import { Modal } from "../Modal/Modal";
import styles from "./ErrorModal.module.css";

export function ErrorModal() {
  const { state, dispatch } = useUI();
  const [copied, setCopied] = useState(false);

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
    <Modal isOpen={state.error !== null} onClose={dismiss}>
      <div className={styles.dialog}>
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
    </Modal>
  );
}
