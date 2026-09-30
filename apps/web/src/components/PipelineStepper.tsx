import type { PipelineStep, StepState, Tone } from "../domain.js";
import { Icon, type IconName } from "./Icon.js";

const STATE: Record<StepState, { icon: IconName | null; tone: Tone }> = {
  done: { icon: "checkCircle", tone: "success" },
  warning: { icon: "alert", tone: "warning" },
  failed: { icon: "xCircle", tone: "danger" },
  active: { icon: null, tone: "info" },
  pending: { icon: null, tone: "neutral" },
  skipped: { icon: "minusCircle", tone: "neutral" },
};

export function PipelineStepper({ steps }: { steps: PipelineStep[] }) {
  return (
    <ol className="dd-stepper" aria-label="Pipeline progress">
      {steps.map((step) => {
        const { icon, tone } = STATE[step.state];
        return (
          <li
            key={step.key}
            className={`dd-step is-${step.state} tone-${tone}`}
            aria-current={step.state === "active" ? "step" : undefined}
          >
            <span className="dd-step-icon" aria-hidden="true">
              {step.state === "active" ? (
                <span className="spinner" />
              ) : icon ? (
                <Icon name={icon} size={20} strokeWidth={2} />
              ) : (
                <span className="dd-step-dot" />
              )}
            </span>
            <span className="dd-step-text">
              <span className="dd-step-label">
                {step.label}
                <span className="sr-only">: </span>
              </span>
              <span className="dd-step-detail" title={step.detail}>
                {step.detail}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
