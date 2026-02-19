export type ThemeFamily = 'drydock' | 'github' | 'dracula' | 'catppuccin';
export type ThemeVariant = 'dark' | 'light' | 'system';

export interface ThemeFamilyMeta {
  id: ThemeFamily;
  label: string;
  description: string;
  swatchDark: string;
  swatchLight: string;
  accent: string;
}

export const themeFamilies: ThemeFamilyMeta[] = [
  {
    id: 'drydock',
    label: 'Drydock',
    description: 'Navy and slate tones',
    swatchDark: '#0f172a',
    swatchLight: '#f8fafc',
    accent: '#0096C7',
  },
  {
    id: 'github',
    label: 'GitHub',
    description: 'Clean and familiar',
    swatchDark: '#0d1117',
    swatchLight: '#ffffff',
    accent: '#58a6ff',
  },
  {
    id: 'dracula',
    label: 'Dracula',
    description: 'Bold purple vibes',
    swatchDark: '#282a36',
    swatchLight: '#f8f8f2',
    accent: '#bd93f9',
  },
  {
    id: 'catppuccin',
    label: 'Catppuccin',
    description: 'Warm pastel tones',
    swatchDark: '#1e1e2e',
    swatchLight: '#eff1f5',
    accent: '#89dceb',
  },
];
