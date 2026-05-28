import type { ReactNode } from "react";
import { Modal } from "../Modal/Modal";
import styles from "./ConfirmDialog.module.css";

interface ConfirmDialogProps {
  title: string;
  message: string | ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  infoOnly?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  infoOnly = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal isOpen onClose={onCancel}>
      <div className={styles.dialog}>
        <h3 className={styles.title}>{title}</h3>
        <p className={styles.message}>{message}</p>
        <div className={styles.actions}>
          {infoOnly ? (
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
