export const RADIUS_PRESET_IDS = ['none', 'sharp', 'modern', 'soft', 'round'] as const;
export type RadiusPresetId = (typeof RADIUS_PRESET_IDS)[number];

export interface RadiusPreset {
  id: RadiusPresetId;
  label: string;
  sm: number;
  md: number;
  lg: number;
}

const RADIUS_PRESET_BY_ID: Record<RadiusPresetId, RadiusPreset> = {
  none: { id: 'none', label: 'None', sm: 0, md: 0, lg: 0 },
  sharp: { id: 'sharp', label: 'Sharp', sm: 2, md: 3, lg: 4 },
  modern: { id: 'modern', label: 'Modern', sm: 4, md: 8, lg: 12 },
  soft: { id: 'soft', label: 'Soft', sm: 6, md: 12, lg: 16 },
  round: { id: 'round', label: 'Round', sm: 8, md: 16, lg: 24 },
};

export const RADIUS_PRESET_VALUES: RadiusPreset[] = RADIUS_PRESET_IDS.map(
  (id) => RADIUS_PRESET_BY_ID[id],
);

/** Apply border-radius CSS variables to documentElement. */
export function applyRadius(id: RadiusPresetId): void {
  const p = RADIUS_PRESET_BY_ID[id];
  const el = document.documentElement;
  el.style.setProperty('--dd-radius', `${p.md}px`);
  el.style.setProperty('--dd-radius-sm', `${p.sm}px`);
  el.style.setProperty('--dd-radius-lg', `${p.lg}px`);
}
