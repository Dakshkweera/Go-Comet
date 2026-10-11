export function ProgressBar({ percent, label }: { percent: number; label: string }) {
  return (
    <span
      className="progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <span className="progress-fill" style={{ width: `${percent}%` }} />
    </span>
  );
}
