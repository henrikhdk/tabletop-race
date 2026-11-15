/** Shared progress (0..1) of the opening sequence, read by the decor system. */
export const introState = {
  boats: 1,
  heli: 1,
};

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** 0..1 progress of a window [a, b] inside the timeline */
export const win = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
export const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
export const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
export const easeOutBack = (x: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return x <= 0 ? 0 : 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};
