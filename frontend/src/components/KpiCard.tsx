import type { Tone } from "../domain.js";
import { Link } from "../router.js";
import { Icon, type IconName } from "./Icon.js";

export function KpiCard({
  label,
  value,
  detail,
  icon,
  tone = "neutral",
  to,
}: {
  label: string;
  value: number | string;
  detail?: string;
  icon: IconName;
  tone?: Tone;
  to?: string;
}) {
  const content = (
    <>
      <span className="ov-kpi-head">
        <span className={`ov-kpi-icon tone-${tone}`}>
          <Icon name={icon} size={14} strokeWidth={2} />
        </span>
        <span className="ov-kpi-label">{label}</span>
        {to && <Icon name="arrowRight" size={14} className="ov-kpi-arrow" />}
      </span>
      <span className="ov-kpi-value">
        {typeof value === "number" ? value.toLocaleString() : value}
      </span>
      {detail && <span className="ov-kpi-detail">{detail}</span>}
    </>
  );

  return to ? (
    <Link to={to} className="ov-kpi">
      {content}
    </Link>
  ) : (
    <div className="ov-kpi">{content}</div>
  );
}
