export type IconButtonSize = 'toolbar' | 'xs' | 'sm' | 'md' | 'lg';

// toolbar and xs reach the 44 px touch minimum below `md` (touch layouts); at `md` and up they
// keep the compact desktop footprint, which is pointer-driven.
export const iconButtonSizeClasses: Record<IconButtonSize, string> = {
  toolbar: 'w-11 h-11 md:w-8 md:h-8',
  xs: 'w-11 h-11 md:w-10 md:h-10',
  sm: 'w-11 h-11',
  md: 'w-12 h-12',
  lg: 'w-14 h-14',
};

// Desktop (`md` and up) pixel sizes. toolbar (32) and xs (40) are below 44 px by accepted risk
// (DR-94): there they are pointer-sized, used by the ThemeToggle cells in the top bar and the
// toolbar buttons in AuditView, ContainersGroupedViews and ContainerFullPageDetail. Below `md`
// the classes above bring them to 44 px. ThemeToggle reads these pixel values for its own cell
// width, so its cells stay compact.
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
