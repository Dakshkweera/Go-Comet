import "../styles/mail.css";
import { useState } from "react";
import { EmptyState, ErrorState, LoadingRows } from "../components/EmptyState.js";
import { Icon } from "../components/Icon.js";
import { PageHeader } from "../components/PageHeader.js";
import { Badge } from "../components/StatusBadge.js";
import { formatDateTime } from "../domain.js";
import { useSentEmails } from "../shipmentData.js";
import { outboundKindMeta } from "../shipmentDomain.js";
import { Link, useSearchParams } from "../router.js";
import type { SentEmail } from "../types/api.js";

function SentItem({
  email,
  open,
  onToggle,
}: {
  email: SentEmail;
  open: boolean;
  onToggle: () => void;
}) {
  const kind = outboundKindMeta(email.kind);
  return (
    <li className={open ? "ml-item is-open" : "ml-item"}>
      <div className="ml-row">
        <button
          type="button"
          className="ml-toggle"
          aria-expanded={open}
          aria-controls={`ml-body-${email.id}`}
          onClick={onToggle}
        >
          <Icon name={open ? "chevronDown" : "chevronRight"} size={15} className="text-faint" />
          <span className="ml-main">
            <span className="ml-subject">{email.subject}</span>
            <span className="ml-to">To {email.to}</span>
          </span>
        </button>
        <span className="ml-badges">
          <Badge tone={kind.tone} icon={null} size="sm">
            {kind.label}
          </Badge>
          <Badge tone="neutral" icon={null} size="sm" title="No real email was sent">
            Simulated
          </Badge>
        </span>
        <time className="ml-time" dateTime={email.sentAt}>
          {formatDateTime(email.sentAt)}
        </time>
        <Link to={`/shipments/${encodeURIComponent(email.shipmentId)}`} className="ml-ref mono">
          {email.reference}
        </Link>
      </div>
      {open && (
        <div className="ml-detail" id={`ml-body-${email.id}`}>
          <dl className="kv ml-kv">
            <dt>From</dt>
            <dd>{email.from}</dd>
            <dt>To</dt>
            <dd>{email.to}</dd>
            <dt>Subject</dt>
            <dd>{email.subject}</dd>
            {email.edited && (
              <>
                <dt>Draft</dt>
                <dd>Edited by you before sending</dd>
              </>
            )}
          </dl>
          <pre className="ml-body">{email.body}</pre>
        </div>
      )}
    </li>
  );
}

export function SentEmailsPage() {
  const { sent, loading, error, refresh } = useSentEmails();
  const [expanded, setExpanded] = useState<string | null>(useSearchParams().get("open"));

  return (
    <div className="page">
      <PageHeader
        title="Sent emails"
        description="Replies sent to suppliers after your review. Every email here is simulated: nothing leaves the system."
      />

      <div className="panel">
        {error ? (
          <ErrorState
            message={`Could not load sent emails: ${error}`}
            onRetry={() => void refresh()}
          />
        ) : loading ? (
          <LoadingRows rows={4} />
        ) : !sent || sent.length === 0 ? (
          <EmptyState
            icon="send"
            title="No emails sent yet"
            action={
              <Link to="/shipments" className="btn btn-secondary btn-sm">
                Go to Shipments
              </Link>
            }
          >
            Replies you send from a shipment appear here.
          </EmptyState>
        ) : (
          <ul className="ml-list">
            {sent.map((email) => (
              <SentItem
                key={email.id}
                email={email}
                open={expanded === email.id}
                onToggle={() => setExpanded(expanded === email.id ? null : email.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
