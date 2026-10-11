import "../styles/mail.css";
import { useState } from "react";
import { EmptyState, ErrorState, LoadingRows } from "../components/EmptyState.js";
import { Icon } from "../components/Icon.js";
import { PageHeader } from "../components/PageHeader.js";
import { RefreshButton } from "../components/RefreshButton.js";
import { Badge } from "../components/StatusBadge.js";
import { formatBytes, formatDateTime, plural, timeAgo } from "../domain.js";
import { useMail } from "../shipmentData.js";
import { shipmentPath, type MailRow } from "../shipmentDomain.js";
import { Link } from "../router.js";

function MailItem({
  mail,
  open,
  onToggle,
}: {
  mail: MailRow;
  open: boolean;
  onToggle: () => void;
}) {
  const sender = mail.sender.name ?? mail.sender.address;
  const shipment = shipmentPath(mail.shipmentId, "inbox");

  return (
    <li className={open ? "ml-item is-open" : "ml-item"}>
      <div className="ml-row">
        <button
          type="button"
          className="ml-toggle"
          aria-expanded={open}
          aria-controls={`ml-body-${mail.id}`}
          onClick={onToggle}
        >
          <Icon name={open ? "chevronDown" : "chevronRight"} size={15} className="text-faint" />
          <span className="ml-main">
            <span className="ml-subject">{mail.subject}</span>
            <span className="ml-to">
              From {sender} · {plural(mail.files.length, "attachment")}
            </span>
          </span>
        </button>
        <span className="ml-badges">
          <Badge tone={mail.cycle > 1 ? "info" : "neutral"} icon={null} size="sm">
            {mail.cycle > 1 ? "Reply" : "New shipment"}
          </Badge>
        </span>
        <time
          className="ml-time"
          dateTime={mail.receivedAt}
          title={formatDateTime(mail.receivedAt)}
        >
          {timeAgo(mail.receivedAt)}
        </time>
        <Link to={shipment} className="ml-ref mono">
          {mail.reference}
        </Link>
      </div>
      {open && (
        <div className="ml-detail" id={`ml-body-${mail.id}`}>
          <dl className="kv ml-kv">
            <dt>From</dt>
            <dd>
              {mail.sender.name
                ? `${mail.sender.name} <${mail.sender.address}>`
                : mail.sender.address}
            </dd>
            <dt>Received</dt>
            <dd>{formatDateTime(mail.receivedAt)}</dd>
            <dt>Subject</dt>
            <dd>{mail.subject}</dd>
          </dl>
          <pre className="ml-body">{mail.body || "This email has no text."}</pre>
          {mail.files.length > 0 && (
            <ul className="ml-files" aria-label="Attachments">
              {mail.files.map((file) => (
                <li key={file.id}>
                  <Icon name="file" size={14} className="text-faint" />
                  <span className="ml-file-name">{file.filename}</span>
                  <span className="text-muted">{formatBytes(file.size)}</span>
                </li>
              ))}
            </ul>
          )}
          <p>
            <Link to={shipment} className="btn btn-secondary btn-sm">
              Open {mail.reference}
              <Icon name="arrowRight" size={14} />
            </Link>
          </p>
        </div>
      )}
    </li>
  );
}

export function InboxPage() {
  const { rows, loading, error, refresh } = useMail();
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="page">
      <PageHeader
        title="Inbox"
        description="Emails received from suppliers. What Nova does with each one is on the Processing, Exceptions and Shipments pages."
        actions={<RefreshButton />}
      />

      <div className="panel">
        {error ? (
          <ErrorState message={`Could not load emails: ${error}`} onRetry={refresh} />
        ) : loading ? (
          <LoadingRows rows={4} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="inbox"
            title="No emails yet"
            action={
              <Link to="/simulate" className="btn btn-secondary btn-sm">
                Simulate a supplier email
              </Link>
            }
          >
            Supplier emails appear here as soon as they arrive.
          </EmptyState>
        ) : (
          <ul className="ml-list">
            {rows.map((mail) => (
              <MailItem
                key={mail.id}
                mail={mail}
                open={expanded === mail.id}
                onToggle={() => setExpanded(expanded === mail.id ? null : mail.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
