export type IconButtonSize = 'toolbar' | 'xs' | 'sm' | 'md' | 'lg';

export const iconButtonSizeClasses: Record<IconButtonSize, string> = {
  toolbar: 'w-8 h-8',
  xs: 'w-10 h-10',
  sm: 'w-11 h-11',
  md: 'w-12 h-12',
  lg: 'w-14 h-14',
};

export const iconButtonPixels: Record<IconButtonSize, number> = {
  toolbar: 32,
  xs: 40,
  sm: 44,
  md: 48,
  lg: 56,
};

export const iconButtonIconSizes: Record<IconButtonSize, number> = {
  toolbar: 15,
  xs: 16,
  sm: 18,
  md: 20,
  lg: 24,
};
