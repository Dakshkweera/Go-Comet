import { useEffect, useRef, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon.js";

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  busyLabel,
  busy,
  error,
  onConfirm,
  onCancel,
  icon = "trash",
  tone = "danger",
  errorTitle = "Deletion failed.",
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busyLabel: string;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  icon?: IconName;
  tone?: "danger" | "info";
  errorTitle?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const dismiss = () => {
    if (!busy) onCancel();
  };

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby="confirm-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        dismiss();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) dismiss();
      }}
    >
      <div className="dialog-panel">
        <div className={`dialog-icon tone-${tone}`} aria-hidden="true">
          <Icon name={icon} size={18} />
        </div>
        <div className="dialog-content">
          <h2 className="dialog-title" id="confirm-dialog-title">
            {title}
          </h2>
          <div className="dialog-body">{children}</div>
          {error && (
            <div className="callout tone-danger dialog-error" role="alert">
              <Icon name="alert" size={16} />
              <span>
                <strong>{errorTitle}</strong> {error}
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="dialog-actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={dismiss}
          disabled={busy}
          autoFocus
        >
          Cancel
        </button>
        <button
          type="button"
          className={tone === "danger" ? "btn btn-danger" : "btn btn-primary"}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name={icon} size={15} />}
          {busy ? busyLabel : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
