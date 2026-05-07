export type ThemeFamily = 'one-dark' | 'github' | 'dracula' | 'catppuccin' | 'gruvbox' | 'ayu';
export type ThemeVariant = 'dark' | 'light' | 'system';

interface ThemeFamilyMeta {
  id: ThemeFamily;
  label: string;
  swatchDark: string;
  swatchLight: string;
  accent: string;
}

export const themeFamilies: ThemeFamilyMeta[] = [
  {
    id: 'one-dark',
    label: 'One Dark',
    swatchDark: '#282c34',
    swatchLight: '#fafafa',
    accent: '#528bff',
  },
  {
    id: 'github',
    label: 'GitHub',
    swatchDark: '#0d1117',
    swatchLight: '#ffffff',
    accent: '#58a6ff',
  },
  {
    id: 'dracula',
    label: 'Dracula',
    swatchDark: '#282a36',
    swatchLight: '#f8f8f2',
    accent: '#bd93f9',
  },
  {
    id: 'catppuccin',
    label: 'Catppuccin',
    swatchDark: '#1e1e2e',
    swatchLight: '#eff1f5',
    accent: '#89dceb',
  },
  {
    id: 'gruvbox',
    label: 'Gruvbox',
    swatchDark: '#282828',
    swatchLight: '#fbf1c7',
    accent: '#fe8019',
  },
  {
    id: 'ayu',
    label: 'Ayu',
    swatchDark: '#242936',
    swatchLight: '#fcfcfc',
    accent: '#ffcc66',
  },
];
