import { computed, ref, watch } from 'vue';
import { preferences } from '../preferences/store';
import { type ThemeFamily, type ThemeVariant, themeFamilies } from './palettes';

const DEFAULT_THEME_FAMILY: ThemeFamily = 'one-dark';
const DEFAULT_THEME_VARIANT: ThemeVariant = 'dark';
const THEME_FAMILIES = new Set<ThemeFamily>(themeFamilies.map((family) => family.id));
const THEME_VARIANTS = new Set<ThemeVariant>(['dark', 'light', 'system']);

function isThemeFamily(value: unknown): value is ThemeFamily {
  return typeof value === 'string' && THEME_FAMILIES.has(value as ThemeFamily);
}

function isThemeVariant(value: unknown): value is ThemeVariant {
  return typeof value === 'string' && THEME_VARIANTS.has(value as ThemeVariant);
}

const themeFamily = computed<ThemeFamily>(() =>
  isThemeFamily(preferences.theme.family) ? preferences.theme.family : DEFAULT_THEME_FAMILY,
);
const themeVariant = computed<ThemeVariant>(() =>
  isThemeVariant(preferences.theme.variant) ? preferences.theme.variant : DEFAULT_THEME_VARIANT,
);

const systemDark = ref(globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true);

// Listen for system preference changes — trigger transition when on 'system' mode
try {
  globalThis.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (themeVariant.value === 'system') {
      transitionTheme(() => {
        systemDark.value = e.matches;
      });
    } else {
      systemDark.value = e.matches;
    }
  });
} catch {
  /* ignored */
}

const resolvedVariant = computed<'dark' | 'light'>(() =>
  themeVariant.value === 'system' ? (systemDark.value ? 'dark' : 'light') : themeVariant.value,
);

const isDark = computed(() => resolvedVariant.value === 'dark');

// Apply classes on <html> — called directly (not in watchEffect) so we control timing
function applyClasses() {
  const el = document.documentElement;
  el.className = el.className
    .replace(/\btheme-\S+/g, '')
    .replace(/\b(dark|light)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const family = themeFamily.value;
  const variant = resolvedVariant.value;
  if (family !== 'one-dark') {
    el.classList.add(`theme-${family}`);
  }
  el.classList.add(variant);
}

// Initial application
applyClasses();

// Watch for changes not triggered via transitionTheme (e.g. direct ref sets)
watch(
  [themeFamily, themeVariant, systemDark],
  () => {
    if (!isTransitioning) applyClasses();
  },
  { flush: 'sync' },
);

let isTransitioning = false;

function setThemeFamily(family: ThemeFamily) {
  preferences.theme.family = family;
}

function setThemeVariant(variant: ThemeVariant) {
  preferences.theme.variant = variant;
}

function toggleVariant() {
  if (preferences.theme.variant === 'dark') preferences.theme.variant = 'light';
  else if (preferences.theme.variant === 'light') preferences.theme.variant = 'system';
  else preferences.theme.variant = 'dark';
}

async function transitionTheme(change: () => void, e?: MouseEvent) {
  const startViewTransition = (
    document as Document & {
      startViewTransition?: (callback: () => void) => { finished: Promise<void> };
    }
  ).startViewTransition?.bind(document);
  if (!startViewTransition) {
    change();
    return;
  }

  const root = document.documentElement;
  if (e) {
    root.style.setProperty('--dd-transition-x', `${e.clientX}px`);
    root.style.setProperty('--dd-transition-y', `${e.clientY}px`);
  } else {
    root.style.setProperty('--dd-transition-x', '50%');
    root.style.setProperty('--dd-transition-y', '50%');
  }

  root.classList.add('dd-transitioning');

  isTransitioning = true;
  const transition = startViewTransition(() => {
    change();
    applyClasses();
  });

  try {
    await transition.finished;
  } catch {
    /* aborted */
  }
  isTransitioning = false;
  root.classList.remove('dd-transitioning');
  root.style.removeProperty('--dd-transition-x');
  root.style.removeProperty('--dd-transition-y');
}

export function useTheme() {
  return {
    themeFamily,
    themeVariant,
    resolvedVariant,
    isDark,
    setThemeFamily,
    setThemeVariant,
    toggleVariant,
    transitionTheme,
  };
}
