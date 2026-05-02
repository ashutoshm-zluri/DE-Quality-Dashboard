import { useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import Modal from "./Modal";

interface Props {
  open: boolean;
  title: string;
  message: ReactNode;
  /** Render the confirm button in red. Default true for destructive flows. */
  destructive?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  destructive = true,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  onConfirm,
  onClose,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  // Reset error when reopened
  if (!open && error) setError(null);

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      width="md"
      title={
        <div className="flex items-center gap-2">
          {destructive && (
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
              <AlertTriangle className="h-4 w-4" />
            </span>
          )}
          <span>{title}</span>
        </div>
      }
      footer={
        <>
          {error && (
            <span className="mr-auto text-xs text-red-600">{error}</span>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="btn"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy}
            className={destructive ? "btn-danger" : "btn-primary"}
            autoFocus
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-sm text-ink-700">{message}</div>
    </Modal>
  );
}
