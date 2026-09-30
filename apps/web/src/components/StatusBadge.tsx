import type { ReactNode } from "react";
import type { EvidenceStatus, ValidationStatus } from "@nova/contracts";
import { decisionMeta, EVIDENCE, runStatusMeta, VALIDATION, type Tone } from "../domain.js";
import { Icon, type IconName } from "./Icon.js";

const TONE_ICON: Record<Tone, IconName | null> = {
  neutral: null,
  info: null,
  success: "checkCircle",
  warning: "alert",
  danger: "xCircle",
};

export function Badge({
  tone = "neutral",
  icon,
  size = "md",
  title,
  children,
}: {
  tone?: Tone;
  icon?: IconName | null;
  size?: "sm" | "md" | "lg";
  title?: string;
  children: ReactNode;
}) {
  const glyph = icon === undefined ? TONE_ICON[tone] : icon;
  return (
    <span className={`badge badge-${size} tone-${tone}`} title={title}>
      {glyph && <Icon name={glyph} size={size === "lg" ? 16 : 13} strokeWidth={2} />}
      {children}
    </span>
  );
}

export function DecisionBadge({
  decision,
  size,
}: {
  decision: string | null | undefined;
  size?: "sm" | "md" | "lg";
}) {
  const meta = decisionMeta(decision);
  if (!meta) return <span className="text-muted">—</span>;
  return (
    <Badge tone={meta.tone} size={size}>
      {meta.label}
    </Badge>
  );
}

export function RunStatusBadge({ status }: { status: string }) {
  const meta = runStatusMeta(status);
  const processing = status === "PROCESSING" || status === "RECEIVED";
  return (
    <span className={`status-dot tone-${meta.tone}`}>
      <span className={processing ? "dot dot-pulse" : "dot"} />
      {meta.label}
    </span>
  );
}

export function EvidenceBadge({ status }: { status: EvidenceStatus | undefined }) {
  if (!status) return <span className="text-muted text-xs">No evidence check</span>;
  const meta = EVIDENCE[status];
  return (
    <Badge tone={meta.tone} size="sm" icon={null} title={meta.hint}>
      {meta.label}
    </Badge>
  );
}

export function ValidationBadge({ status }: { status: ValidationStatus }) {
  const meta = VALIDATION[status];
  return (
    <Badge tone={meta.tone} size="sm">
      {meta.label}
    </Badge>
  );
}
