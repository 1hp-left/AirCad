const CONTROLS = [
  { label: 'Move', hint: 'pinch object' },
  { label: 'Transform', hint: 'pinch it with both hands' },
  { label: 'Shape', hint: 'L-shape; move up / down' },
  { label: 'Combine', hint: 'pinch two overlapping objects' },
  { label: 'Create', hint: 'hold open palm' },
] as const;

/** Compact reference strip mapping gestures → actions. */
export function GestureLegend() {
  return (
    <div className="legend">
      {CONTROLS.map((control) => (
        <div className="legend-item" key={control.label}>
          <span className="legend-gesture">{control.label}</span>
          <span className="legend-hint">{control.hint}</span>
        </div>
      ))}
    </div>
  );
}
