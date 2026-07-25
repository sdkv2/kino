type Extrapolate = "extend" | "clamp" | "identity";
export interface InterpolateOptions {
  easing?: (t: number) => number;
  extrapolateLeft?: Extrapolate;
  extrapolateRight?: Extrapolate;
}

// Piecewise-linear map of `input` through inputRange→outputRange, optional easing per segment and
// clamped/extended extrapolation. Standard animation-math; mirrors the call sites in components.tsx.
export function interpolate(input: number, inputRange: number[], outputRange: number[], options: InterpolateOptions = {}): number {
  const { easing, extrapolateLeft = "extend", extrapolateRight = "extend" } = options;
  const n = inputRange.length;
  if (input < inputRange[0]) {
    if (extrapolateLeft === "clamp") return outputRange[0];
    if (extrapolateLeft === "identity") return input;
  }
  if (input > inputRange[n - 1]) {
    if (extrapolateRight === "clamp") return outputRange[n - 1];
    if (extrapolateRight === "identity") return input;
  }
  // find segment (input beyond the ends extends the first/last segment)
  let i = 0;
  while (i < n - 2 && input >= inputRange[i + 1]) i++;
  const a = inputRange[i];
  const b = inputRange[i + 1];
  const span = b - a;
  let t = span === 0 ? 0 : (input - a) / span;
  if (easing) t = easing(Math.min(1, Math.max(0, t)));
  return outputRange[i] + (outputRange[i + 1] - outputRange[i]) * t;
}

// --- easing --------------------------------------------------------------------------------------

type EasingFn = (t: number) => number;
export const Easing = {
  cubic: ((t: number) => t * t * t) as EasingFn,
  in: (fn: EasingFn): EasingFn => fn,
  out: (fn: EasingFn): EasingFn => (t) => 1 - fn(1 - t),
  inOut:
    (fn: EasingFn): EasingFn =>
    (t) =>
      t < 0.5 ? fn(2 * t) / 2 : 1 - fn(2 * (1 - t)) / 2,
};
