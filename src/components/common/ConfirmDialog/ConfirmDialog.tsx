import type { ReactNode } from "react";
import { Modal } from "../Modal/Modal";
import styles from "./ConfirmDialog.module.css";

interface ConfirmDialogProps {
  title: string;
  message: string | ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Optional content between the message and the actions (e.g. a radio group). */
  children?: ReactNode;
  destructive?: boolean;
  infoOnly?: boolean;
  /** Work in progress: show a spinner instead of actions and block dismissal. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  children,
  destructive = false,
  infoOnly = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal isOpen onClose={onCancel} closeOnBackdrop={!busy} closeOnEscape={!busy}>
      <div className={styles.dialog}>
        <h3 className={styles.title}>{title}</h3>
        <p className={styles.message}>{message}</p>
        {children}
        <div className={styles.actions}>
          {busy ? (
            <div className={styles.busyRow}>
              <span className={styles.spinner} />
            </div>
          ) : infoOnly ? (
            <button className="btn" onClick={onCancel}>
              {cancelLabel === "Cancel" ? "OK" : cancelLabel}
            </button>
          ) : (
            <>
              <button className="btn" onClick={onCancel}>
                {cancelLabel}
              </button>
              <button
                className={`btn${destructive ? ` ${styles.destructive}` : ""}`}
                onClick={onConfirm}
              >
                {confirmLabel}
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
