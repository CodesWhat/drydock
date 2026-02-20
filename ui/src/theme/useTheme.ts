import { computed, ref, watch } from 'vue';
import type { ThemeFamily, ThemeVariant } from './palettes';

const FAMILY_KEY = 'drydock-theme-family';
const VARIANT_KEY = 'drydock-theme-variant';

function loadFamily(): ThemeFamily {
  try {
    const stored = localStorage.getItem(FAMILY_KEY);
    if (stored && ['drydock', 'github', 'dracula', 'catppuccin'].includes(stored)) {
      return stored as ThemeFamily;
    }
  } catch {
    /* SSR or blocked storage */
  }
  return 'drydock';
}

function loadVariant(): ThemeVariant {
  try {
    const stored = localStorage.getItem(VARIANT_KEY);
    if (stored && ['dark', 'light', 'system'].includes(stored)) {
      return stored as ThemeVariant;
    }
  } catch {
    /* SSR or blocked storage */
  }
  return 'dark';
}

const themeFamily = ref<ThemeFamily>(loadFamily());
const themeVariant = ref<ThemeVariant>(loadVariant());

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
  if (family !== 'drydock') {
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

// Persist to localStorage
watch(
  themeFamily,
  (val) => {
    try {
      localStorage.setItem(FAMILY_KEY, val);
    } catch {
      /* ignored */
    }
  },
  { flush: 'sync' },
);
watch(
  themeVariant,
  (val) => {
    try {
      localStorage.setItem(VARIANT_KEY, val);
    } catch {
      /* ignored */
    }
  },
  { flush: 'sync' },
);

let isTransitioning = false;

function setThemeFamily(family: ThemeFamily) {
  themeFamily.value = family;
}

function setThemeVariant(variant: ThemeVariant) {
  themeVariant.value = variant;
}

function toggleVariant() {
  if (themeVariant.value === 'dark') themeVariant.value = 'light';
  else if (themeVariant.value === 'light') themeVariant.value = 'system';
  else themeVariant.value = 'dark';
}

async function transitionTheme(change: () => void, e?: MouseEvent) {
  if (!(document as any).startViewTransition) {
    change();
    return;
  }

  const x = e?.clientX ?? window.innerWidth / 2;
  const y = e?.clientY ?? window.innerHeight / 2;
  document.documentElement.style.setProperty('--x', `${x}px`);
  document.documentElement.style.setProperty('--y', `${y}px`);
  document.documentElement.classList.add('dd-transitioning');

  isTransitioning = true;
  const transition = (document as any).startViewTransition(() => {
    change();
    applyClasses();
  });

  try {
    await transition.finished;
  } catch {
    /* aborted */
  }
  isTransitioning = false;
  document.documentElement.classList.remove('dd-transitioning');
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
