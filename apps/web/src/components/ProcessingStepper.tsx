import type { ReactNode } from "react";
import type { RunView } from "../api.js";
import { isFinal, stageIndex } from "../domain.js";
import { Icon } from "./Icon.js";

export type StepperPhase = "ready" | "uploading" | "processing";
type StepState = "done" | "active" | "pending" | "failed";

const LABELS = [
  "Document received",
  "Extracting fields",
  "Resolving customer",
  "Validating rules",
  "Making decision",
];

const MARKER: Record<StepState, ReactNode> = {
  done: <Icon name="check" size={12} strokeWidth={2.5} />,
  active: <span className="spinner ov-step-spinner" />,
  pending: null,
  failed: <Icon name="x" size={12} strokeWidth={2.5} />,
};

const STATE_TEXT: Record<StepState, string> = {
  done: "completed",
  active: "in progress",
  pending: "pending",
  failed: "failed",
};

// Resolution, validation and routing run together server-side after extraction, so they are
// never advanced on a timer: only the persisted stage moves the stepper.
function stepStates(phase: StepperPhase, run: RunView | null): StepState[] {
  if (phase === "ready") return ["pending", "pending", "pending", "pending", "pending"];
  if (phase === "uploading" || !run) {
    return [phase === "uploading" ? "active" : "done", "pending", "pending", "pending", "pending"];
  }
  if (isFinal(run.status)) {
    const rest = run.extraction ? "done" : "pending";
    return [
      "done",
      run.extraction ? "done" : "failed",
      rest,
      rest,
      run.decision ? "done" : "failed",
    ];
  }
  const stage = stageIndex(run.currentStage);
  if (stage >= stageIndex("EXTRACTED")) return ["done", "done", "active", "pending", "pending"];
  if (stage >= stageIndex("EXTRACTING")) return ["done", "active", "pending", "pending", "pending"];
  return ["done", "pending", "pending", "pending", "pending"];
}

export function ProcessingStepper({ phase, run }: { phase: StepperPhase; run: RunView | null }) {
  const states = stepStates(phase, run);
  const attempt = run?.attempts.filter((a) => a.stage === "EXTRACTING").length ?? 0;
  const details: (string | null)[] = [
    phase === "uploading" ? "Uploading" : null,
    states[1] === "active" && attempt > 1
      ? `Attempt ${attempt}`
      : run?.status === "RECEIVED"
        ? "Queued"
        : null,
  ];
  const steps = LABELS.map((label, i) => ({
    label,
    state: states[i] ?? "pending",
    detail: details[i] ?? null,
  }));
  const active = steps.find((step) => step.state === "active");

  return (
    <>
      <ol className="ov-steps">
        {steps.map((step) => (
          <li
            key={step.label}
            className={`ov-step is-${step.state}`}
            aria-current={step.state === "active" ? "step" : undefined}
          >
            <span className="ov-step-marker" aria-hidden="true">
              {MARKER[step.state]}
            </span>
            <span className="ov-step-label">
              {step.label}
              <span className="sr-only">, {STATE_TEXT[step.state]}</span>
            </span>
            {step.detail && <span className="ov-step-detail">{step.detail}</span>}
          </li>
        ))}
      </ol>
      <p className="sr-only" role="status" aria-live="polite">
        {active ? [active.label, active.detail].filter(Boolean).join(", ") : ""}
      </p>
    </>
  );
}
