import { ref, watch } from 'vue';
import { type IconLibrary, iconMap } from '../icons';

const STORAGE_KEY = 'drydock-icon-library';
const SCALE_KEY = 'drydock-icon-scale';

function loadLibrary(): IconLibrary {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && stored in iconMap[Object.keys(iconMap)[0]]) {
      return stored as IconLibrary;
    }
  } catch {
    /* SSR or blocked storage */
  }
  return 'ph-duotone';
}

function loadScale(): number {
  try {
    const stored = localStorage.getItem(SCALE_KEY);
    if (stored) {
      const val = parseFloat(stored);
      if (val >= 0.8 && val <= 1.5) return val;
    }
  } catch {
    /* ignored */
  }
  return 1;
}

const iconLibrary = ref<IconLibrary>(loadLibrary());
const iconScale = ref(loadScale());

watch(iconLibrary, (lib) => {
  try {
    localStorage.setItem(STORAGE_KEY, lib);
  } catch {
    /* ignored */
  }
});

watch(iconScale, (scale) => {
  try {
    localStorage.setItem(SCALE_KEY, String(scale));
  } catch {
    /* ignored */
  }
});

function icon(name: string): string {
  return iconMap[name]?.[iconLibrary.value] ?? name;
}

function setIconLibrary(lib: IconLibrary) {
  iconLibrary.value = lib;
}

function setIconScale(scale: number) {
  iconScale.value = scale;
}

export function useIcons() {
  return { iconLibrary, icon, setIconLibrary, iconScale, setIconScale };
}
