import { GESTURE_CONFIG, LEGEND_ORDER } from '../config/gestures';

/** Compact reference strip mapping gestures → actions. */
export function GestureLegend() {
  return (
    <div className="legend">
      {LEGEND_ORDER.map((g) => {
        const cfg = GESTURE_CONFIG[g];
        if (!cfg) return null;
        return (
          <div className="legend-item" key={g}>
            <span className="legend-gesture">{cfg.label}</span>
            <span className="legend-hint">{cfg.hint}</span>
          </div>
        );
      })}
      <div className="legend-item">
        <span className="legend-gesture">Combine</span>
        <span className="legend-hint">two fists grab two objects</span>
      </div>
    </div>
  );
}
