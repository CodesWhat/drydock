import { computed } from 'vue';
import { type IconLibrary, iconMap, libraryLabels } from '../icons';
import { preferences } from '../preferences/store';

const DEFAULT_ICON_LIBRARY: IconLibrary = 'ph-duotone';
const ICON_LIBRARIES = new Set<IconLibrary>(Object.keys(libraryLabels) as IconLibrary[]);

export function isIconLibrary(value: unknown): value is IconLibrary {
  return typeof value === 'string' && ICON_LIBRARIES.has(value as IconLibrary);
}

const iconLibrary = computed<IconLibrary>(() =>
  isIconLibrary(preferences.icons.library) ? preferences.icons.library : DEFAULT_ICON_LIBRARY,
);
const iconScale = computed(() => preferences.icons.scale);

function icon(name: string): string {
  return iconMap[name]?.[iconLibrary.value] ?? name;
}

function setIconLibrary(lib: IconLibrary) {
  preferences.icons.library = lib;
}

function setIconScale(scale: number) {
  preferences.icons.scale = scale;
}

export function useIcons() {
  return { iconLibrary, icon, setIconLibrary, iconScale, setIconScale };
}
