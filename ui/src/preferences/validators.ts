import { RADIUS_PRESET_IDS } from './radius';
import type { ViewMode } from './schema';

export const VIEW_MODES = new Set<ViewMode>(['table', 'cards', 'list']);

export const THEME_FAMILIES = new Set([
  'one-dark',
  'github',
  'dracula',
  'catppuccin',
  'gruvbox',
  'ayu',
]);

export const THEME_VARIANTS = new Set(['dark', 'light', 'system']);

export const FONT_FAMILIES = new Set([
  'ibm-plex-mono',
  'jetbrains-mono',
  'source-code-pro',
  'inconsolata',
  'commit-mono',
  'comic-mono',
]);

export const ICON_LIBRARIES = new Set([
  'ph-duotone',
  'ph',
  'lucide',
  'tabler',
  'heroicons',
  'iconoir',
  'fa6-solid',
]);

export const TABLE_ACTIONS = new Set(['icons', 'buttons']);

export const RADIUS_PRESETS = new Set<string>(RADIUS_PRESET_IDS);

export function isViewMode(v: unknown): v is ViewMode {
  return typeof v === 'string' && VIEW_MODES.has(v as ViewMode);
}

export function isValidScale(v: unknown): v is number {
  return typeof v === 'number' && v >= 0.8 && v <= 1.5;
}

export function isValidFontSize(v: unknown): v is number {
  return typeof v === 'number' && v >= 0.8 && v <= 1.3;
}
