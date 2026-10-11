import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { refreshShipments, sendAndAwaitArrival } from "../shipmentData.js";
import { arrivalMessage, shipmentPath } from "../shipmentDomain.js";
import { Link } from "../router.js";
import type { EmailUploadResult, SampleEmail } from "../types/api.js";
import { EmptyState, LoadingRows } from "./EmptyState.js";
import { Icon } from "./Icon.js";
import { Badge } from "./StatusBadge.js";

type NoticeLink = { path: string; label: string };
type Notice = { tone: "success" | "info" | "danger"; text: string; links?: NoticeLink[] };

const shipmentLink = (id: string): NoticeLink => ({
  path: shipmentPath(id),
  label: "Open shipment",
});

export function SimulatePanel() {
  const [samples, setSamples] = useState<SampleEmail[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .listSamples()
      .then((list) => !cancelled && setSamples(list))
      .catch((err: Error) => !cancelled && setLoadError(err.message));
    return () => {
      cancelled = true;
    };
  }, []);

  async function deliver(sample: SampleEmail) {
    if (busy) return;
    setBusy(sample.name);
    setNotice(null);
    try {
      const arrived = await sendAndAwaitArrival(() => api.deliverSample(sample.name));
      setNotice(
        arrived
          ? {
              tone: "success",
              text: arrivalMessage(arrived),
              links: [shipmentLink(arrived.id), { path: "/processing", label: "See Processing" }],
            }
          : {
              tone: "info",
              text: arrivalMessage(null),
              links: [{ path: "/inbox", label: "Open Inbox" }],
            },
      );
    } catch (err) {
      setNotice({ tone: "danger", text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function upload(file: File) {
    setBusy("upload");
    setNotice(null);
    try {
      const result: EmailUploadResult = await api.uploadEmail(file);
      void refreshShipments();
      setNotice({
        tone: result.duplicate ? "info" : "success",
        text: result.duplicate ? "This email was already received." : "Email received.",
        links: [shipmentLink(result.shipmentId)],
      });
    } catch (err) {
      setNotice({ tone: "danger", text: (err as Error).message });
    } finally {
      setBusy(null);
      if (picker.current) picker.current.value = "";
    }
  }

  return (
    <section className="panel sim-panel" aria-labelledby="sim-title">
      <div className="panel-header">
        <div>
          <h2 className="panel-title" id="sim-title">
            Sample emails
          </h2>
          <p className="panel-subtitle">
            Each sample can be received once. Send a reply only after its original email.
          </p>
        </div>
      </div>

      {notice && (
        <div className={`callout tone-${notice.tone} sim-notice`} role="status">
          <Icon name={notice.tone === "danger" ? "alert" : "info"} size={16} />
          <span>
            {notice.text}
            {notice.links?.map((link) => (
              <span key={link.path}>
                {" "}
                <Link to={link.path}>{link.label}</Link>
              </span>
            ))}
          </span>
        </div>
      )}

      {loadError ? (
        <EmptyState compact icon="alert" title="Samples unavailable">
          {loadError}
        </EmptyState>
      ) : !samples ? (
        <LoadingRows rows={3} />
      ) : samples.length === 0 ? (
        <EmptyState compact icon="mail" title="No sample emails">
          The backend has no sample emails configured.
        </EmptyState>
      ) : (
        <ul className="sim-samples">
          {samples.map((sample) => (
            <li key={sample.name} className="sim-sample">
              <div className="sim-sample-main">
                <p className="sim-sample-subject">
                  {sample.subject}
                  {sample.inReplyTo && (
                    <Badge size="sm" tone="info" icon={null}>
                      Supplier reply
                    </Badge>
                  )}
                </p>
                <p className="sim-sample-from">{sample.from}</p>
                <p className="sim-sample-files">
                  <Icon name="paperclip" size={12} />
                  {sample.attachments.join(" · ")}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => deliver(sample)}
                disabled={busy !== null}
                aria-label={`Deliver “${sample.subject}”`}
              >
                {busy === sample.name ? (
                  <span className="spinner" aria-hidden="true" />
                ) : (
                  <Icon name="send" size={13} />
                )}
                {busy === sample.name ? "Sending…" : "Deliver"}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="panel-footer sim-upload">
        <input
          ref={picker}
          type="file"
          accept=".eml,message/rfc822"
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose an .eml file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => picker.current?.click()}
          disabled={busy !== null}
        >
          {busy === "upload" ? (
            <span className="spinner" aria-hidden="true" />
          ) : (
            <Icon name="upload" size={14} />
          )}
          Upload .eml
        </button>
        <span className="text-muted text-xs">Use your own email file instead of a sample.</span>
      </div>
    </section>
  );
}
