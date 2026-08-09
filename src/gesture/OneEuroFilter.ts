/**
 * 1-Euro filter — a low-pass filter with an adaptive cutoff.
 *
 * Hand landmarks jitter at rest and lag during fast motion. The 1-Euro trick:
 * when the signal moves fast, raise the cutoff (less smoothing, low latency);
 * when it's slow, lower the cutoff (more smoothing, kill jitter). One knob
 * (`beta`) trades jitter for lag. This is the single-filter version applied per
 * scalar (each x/y/z of each landmark gets its own instance).
 *
 * Reference: Casiez et al., "1€ Filter" (CHI 2012).
 */
export class OneEuroFilter {
  private lastTime = 0;
  private lastValue = 0;
  private lastDerivative = 0;
  private initialized = false;

  constructor(
    /** Minimum cutoff frequency (Hz). Lower = smoother at rest. */
    private minCutoff = 1.0,
    /** Speed coefficient. Higher = less lag during fast motion. */
    private beta = 0.007,
    /** Derivative cutoff frequency (Hz). */
    private dCutoff = 1.0,
  ) {}

  /** Exponential smoothing with cutoff in Hz. */
  private static alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  /** Filter a single value at a timestamp in seconds. */
  filter(value: number, timeS: number): number {
    if (!this.initialized) {
      this.initialized = true;
      this.lastTime = timeS;
      this.lastValue = value;
      this.lastDerivative = 0;
      return value;
    }

    const dt = Math.max(timeS - this.lastTime, 1e-5);
    this.lastTime = timeS;

    // Estimate derivative, then smooth it.
    const dx = (value - this.lastValue) / dt;
    const aD = OneEuroFilter.alpha(this.dCutoff, dt);
    const smoothedDx = aD * dx + (1 - aD) * this.lastDerivative;
    this.lastDerivative = smoothedDx;

    // Adapt the value-cutoff to the (smoothed) speed.
    const cutoff = this.minCutoff + this.beta * Math.abs(smoothedDx);
    const a = OneEuroFilter.alpha(cutoff, dt);
    const smoothedValue = a * value + (1 - a) * this.lastValue;
    this.lastValue = smoothedValue;

    return smoothedValue;
  }

  reset(): void {
    this.initialized = false;
  }
}
