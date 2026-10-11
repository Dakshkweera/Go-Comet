import {
  cellTone,
  confidenceMeta,
  confidenceTitle,
  currentDocuments,
  docStatusMeta,
  documentTypeLabel,
  fieldResult,
  formatObservation,
  gridSummary,
  isProcessing,
  observationAt,
} from "../shipmentDomain.js";
import type { ShipmentDocument, ShipmentField, ShipmentView } from "../types/api.js";
import { EmptyState } from "./EmptyState.js";
import { Icon } from "./Icon.js";
import { SectionHeader } from "./PageHeader.js";
import { Badge } from "./StatusBadge.js";

function Cell({ field, doc }: { field: ShipmentField; doc: ShipmentDocument }) {
  const o = observationAt(field, doc.id);
  if (!o) {
    return (
      <td className="sd-cell is-empty" title="This field is not on this document">
        —
      </td>
    );
  }
  const tone = cellTone(o);
  return (
    <td className={tone ? `sd-cell is-flagged tone-${tone}` : "sd-cell"}>
      <span className="sd-cell-value">{formatObservation(o)}</span>
      <span className="sd-cell-meta">
        {o.isOwner && (
          <Badge size="sm" tone="info" icon={null} title="The document that decides this field">
            Owner
          </Badge>
        )}
        <span
          className={`sd-conf tone-${confidenceMeta(o.confidenceLevel).tone}`}
          title={confidenceTitle(o)}
        >
          <span className="dot" aria-hidden="true" />
          {confidenceMeta(o.confidenceLevel).label}
        </span>
      </span>
    </td>
  );
}

export function VerificationGrid({
  view,
  onOpenField,
}: {
  view: ShipmentView;
  onOpenField: (field: ShipmentField["field"]) => void;
}) {
  const docs = currentDocuments(view);
  const summary = gridSummary(view);

  return (
    <section className="section" aria-labelledby="sd-grid-title">
      <SectionHeader
        id="sd-grid-title"
        title="Verification"
        subtitle={summary ?? "Fields appear here as the attachments are read."}
      />
      {view.fields.length === 0 ? (
        <div className="panel">
          <EmptyState
            compact
            icon={isProcessing(view.status) ? "clock" : "documents"}
            title="No fields yet"
          >
            {isProcessing(view.status)
              ? "Nova is reading the attachments."
              : "No fields could be read from these attachments."}
          </EmptyState>
        </div>
      ) : (
        <div className="panel sd-grid-panel">
          <div className="table-wrap">
            <table className="table sd-grid">
              <thead>
                <tr>
                  <th scope="col">Field</th>
                  {docs.map((d) => (
                    <th scope="col" key={d.id}>
                      <span className="sd-col-type">{documentTypeLabel(d)}</span>
                      <span className="sd-col-file">{d.filename}</span>
                      {d.status === "failed" && (
                        <span className="sd-col-note">{docStatusMeta(d.status).label}</span>
                      )}
                    </th>
                  ))}
                  <th scope="col">Expected</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {view.fields.map((f) => {
                  const result = fieldResult(f);
                  return (
                    <tr
                      key={f.field}
                      className={
                        f.state === "ok"
                          ? "is-clickable"
                          : `is-clickable sd-row-flagged tone-${result.tone}`
                      }
                      onClick={() => onOpenField(f.field)}
                    >
                      <th scope="row" className="sd-field">
                        <button
                          type="button"
                          className="sd-field-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenField(f.field);
                          }}
                          aria-label={`${f.label}: see details`}
                        >
                          {f.label}
                          <Icon name="chevronRight" size={13} className="text-faint" />
                        </button>
                      </th>
                      {docs.map((d) => (
                        <Cell key={d.id} field={f} doc={d} />
                      ))}
                      <td className="sd-expected">
                        {f.expected ?? <span className="text-faint">—</span>}
                      </td>
                      <td className="sd-result" title={f.reason ?? undefined}>
                        <Badge size="sm" tone={result.tone}>
                          {result.label}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="sd-grid-note">
            Confidence shows how clearly each value was read. “—” means the field is not on that
            document, which is normal. Select a row for the source snippets.
          </p>
        </div>
      )}
    </section>
  );
}
