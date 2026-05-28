import { useEffect, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./Modal.module.css";

interface ModalProps {
  isOpen: boolean;
  onClose?: () => void;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  children: ReactNode;
}

export function Modal({
  isOpen,
  onClose,
  closeOnBackdrop = true,
  closeOnEscape = true,
  children,
}: ModalProps) {
  useEffect(() => {
    if (!isOpen || !onClose || !closeOnEscape) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose!();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose, closeOnEscape]);

  if (!isOpen) return null;

  function handleClick(e: MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget && closeOnBackdrop && onClose) onClose();
  }

  return createPortal(
    <div className={styles.backdrop} onClick={handleClick}>
      {children}
    </div>,
    document.body,
  );
}
