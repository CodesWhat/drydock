const FONT_SIZE_MIN = 0.8;
const FONT_SIZE_MAX = 1.3;
const FONT_SIZE_STEP = 0.05;

const STEP_COUNT = Math.round((FONT_SIZE_MAX - FONT_SIZE_MIN) / FONT_SIZE_STEP) + 1;

export const FONT_SIZE_CLASS_PREFIX = 'dd-font-size-';

export const FONT_SIZE_SCALE_VALUES = Object.freeze(
  Array.from({ length: STEP_COUNT }, (_, index) =>
    Number.parseFloat((FONT_SIZE_MIN + index * FONT_SIZE_STEP).toFixed(2)),
  ),
);

const FONT_SIZE_CLASS_NAMES = new Set(
  FONT_SIZE_SCALE_VALUES.map((scale) => `${FONT_SIZE_CLASS_PREFIX}${Math.round(scale * 100)}`),
);

export function normalizeFontSizeScale(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }

  const clamped = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, value));
  const stepped = Math.round(clamped / FONT_SIZE_STEP) * FONT_SIZE_STEP;
  return Number.parseFloat(stepped.toFixed(2));
}

export function fontSizeClassForScale(scale: number): string {
  const normalized = normalizeFontSizeScale(scale);
  return `${FONT_SIZE_CLASS_PREFIX}${Math.round(normalized * 100)}`;
}

export function clearFontSizeClasses(el: Element = document.documentElement): void {
  for (const className of FONT_SIZE_CLASS_NAMES) {
    el.classList.remove(className);
  }
}

export function applyFontSize(scale: number): number {
  const normalized = normalizeFontSizeScale(scale);
  const el = document.documentElement;
  clearFontSizeClasses(el);
  el.classList.add(fontSizeClassForScale(normalized));
  return normalized;
}
