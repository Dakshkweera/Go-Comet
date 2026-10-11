import { backTarget } from "../shipmentDomain.js";
import { Link, useSearchParams } from "../router.js";
import { Icon } from "./Icon.js";

// Shipment pages are opened from several lists; `?from=` says which one to return to.
export const useBackTarget = () => backTarget(useSearchParams().get("from"));

export function BackLink() {
  const back = useBackTarget();
  return (
    <Link to={back.to} className="back-link">
      <Icon name="arrowLeft" size={14} />
      Back to {back.label}
    </Link>
  );
}
