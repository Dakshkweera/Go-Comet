import { useRef, useState } from "react";
import { removeShipment } from "../shipmentData.js";
import { isProcessing } from "../shipmentDomain.js";
import type { ShipmentSummary } from "../types/api.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { Icon } from "./Icon.js";

export function DeleteShipmentAction({
  shipment,
  iconOnly = false,
  onDeleted,
}: {
  shipment: Pick<ShipmentSummary, "id" | "reference" | "status">;
  iconOnly?: boolean;
  onDeleted?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const processing = isProcessing(shipment.status);

  async function remove() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await removeShipment(shipment.id);
      onDeleted?.();
    } catch (err) {
      busyRef.current = false;
      setBusy(false);
      setError((err as Error).message);
    }
  }

  return (
    <>
      <button
        type="button"
        className={
          iconOnly ? "btn btn-ghost btn-sm btn-icon dd-delete" : "btn btn-ghost btn-sm dd-delete"
        }
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        disabled={processing}
        aria-label={iconOnly ? `Delete ${shipment.reference}` : undefined}
        title={processing ? "A shipment can be deleted once processing finishes" : undefined}
      >
        <Icon name="trash" size={14} />
        {!iconOnly && "Delete shipment"}
      </button>
      <ConfirmDialog
        open={open}
        title={`Delete ${shipment.reference}?`}
        confirmLabel="Delete shipment"
        busyLabel="Deleting…"
        busy={busy}
        error={error}
        onConfirm={remove}
        onCancel={() => setOpen(false)}
      >
        <p>
          This permanently removes <strong>{shipment.reference}</strong>: its emails, attachments,
          extracted data, your review decisions and any replies sent from it.
        </p>
        <p>
          The supplier email can then be received again, for example by delivering a sample. This
          cannot be undone.
        </p>
      </ConfirmDialog>
    </>
  );
}
