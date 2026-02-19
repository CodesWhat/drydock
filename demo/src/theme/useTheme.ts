import { ref, computed, watchEffect } from 'vue';
import type { ThemeFamily, ThemeVariant } from './palettes';

const FAMILY_KEY = 'drydock-theme-family';
const VARIANT_KEY = 'drydock-theme-variant';

function loadFamily(): ThemeFamily {
  try {
    const stored = localStorage.getItem(FAMILY_KEY);
    if (stored && ['drydock', 'github', 'dracula', 'catppuccin'].includes(stored)) {
      return stored as ThemeFamily;
    }
  } catch { /* SSR or blocked storage */ }
  return 'drydock';
}

function loadVariant(): ThemeVariant {
  try {
    const stored = localStorage.getItem(VARIANT_KEY);
    if (stored && ['dark', 'light', 'system'].includes(stored)) {
      return stored as ThemeVariant;
    }
  } catch { /* SSR or blocked storage */ }
  return 'dark';
}

const themeFamily = ref<ThemeFamily>(loadFamily());
const themeVariant = ref<ThemeVariant>(loadVariant());

const systemDark = ref(globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true);

// Listen for system preference changes
try {
  globalThis.matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', (e) => { systemDark.value = e.matches; });
} catch { /* ignored */ }

const resolvedVariant = computed<'dark' | 'light'>(() =>
  themeVariant.value === 'system' ? (systemDark.value ? 'dark' : 'light') : themeVariant.value
);

const isDark = computed(() => resolvedVariant.value === 'dark');

// Apply classes on <html>
watchEffect(() => {
  const el = document.documentElement;
  // Remove all theme-* classes
  el.className = el.className.replace(/\btheme-\S+/g, '').replace(/\b(dark|light)\b/g, '').replace(/\s+/g, ' ').trim();
  // Add current theme
  const family = themeFamily.value;
  const variant = resolvedVariant.value;
  if (family !== 'drydock') {
    el.classList.add(`theme-${family}`);
  }
  el.classList.add(variant);
});

// Persist to localStorage
watchEffect(() => {
  try { localStorage.setItem(FAMILY_KEY, themeFamily.value); } catch { /* ignored */ }
});
watchEffect(() => {
  try { localStorage.setItem(VARIANT_KEY, themeVariant.value); } catch { /* ignored */ }
});

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

export function useTheme() {
  return { themeFamily, themeVariant, resolvedVariant, isDark, setThemeFamily, setThemeVariant, toggleVariant };
}
