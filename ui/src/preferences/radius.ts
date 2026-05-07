export const RADIUS_PRESET_IDS = ['none', 'sharp', 'modern', 'soft', 'round'] as const;
export type RadiusPresetId = (typeof RADIUS_PRESET_IDS)[number];

export interface RadiusPreset {
  id: RadiusPresetId;
  sm: number;
  md: number;
  lg: number;
}

const RADIUS_CLASS_PREFIX = 'dd-radius-';
const RADIUS_CLASS_NAMES = new Set(RADIUS_PRESET_IDS.map((id) => `${RADIUS_CLASS_PREFIX}${id}`));

const RADIUS_PRESET_BY_ID: Record<RadiusPresetId, RadiusPreset> = {
  none: { id: 'none', sm: 0, md: 0, lg: 0 },
  sharp: { id: 'sharp', sm: 2, md: 3, lg: 4 },
  modern: { id: 'modern', sm: 4, md: 8, lg: 12 },
  soft: { id: 'soft', sm: 6, md: 12, lg: 16 },
  round: { id: 'round', sm: 8, md: 16, lg: 24 },
};

export const RADIUS_PRESET_VALUES: RadiusPreset[] = RADIUS_PRESET_IDS.map(
  (id) => RADIUS_PRESET_BY_ID[id],
);

/** Apply radius preset as a class on the document root. */
export function applyRadius(id: RadiusPresetId): void {
  const el = document.documentElement;
  for (const className of RADIUS_CLASS_NAMES) {
    el.classList.remove(className);
  }
  el.classList.add(`${RADIUS_CLASS_PREFIX}${id}`);
}
