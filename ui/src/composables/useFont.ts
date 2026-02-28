import { ref, watch } from 'vue';

const STORAGE_KEY = 'drydock-font-family-v1';

export type FontId =
  | 'ibm-plex-mono'
  | 'jetbrains-mono'
  | 'source-code-pro'
  | 'inconsolata'
  | 'commit-mono'
  | 'comic-mono';

export interface FontOption {
  id: FontId;
  label: string;
  family: string;
  weights: number[];
  bundled: boolean;
}

export const fontOptions: FontOption[] = [
  {
    id: 'ibm-plex-mono',
    label: 'IBM Plex Mono',
    family: '"IBM Plex Mono", monospace',
    weights: [300, 400, 500, 600, 700],
    bundled: true,
  },
  {
    id: 'jetbrains-mono',
    label: 'JetBrains Mono',
    family: '"JetBrains Mono", monospace',
    weights: [300, 400, 500, 600, 700],
    bundled: false,
  },
  {
    id: 'source-code-pro',
    label: 'Source Code Pro',
    family: '"Source Code Pro", monospace',
    weights: [300, 400, 500, 600, 700],
    bundled: false,
  },
  {
    id: 'inconsolata',
    label: 'Inconsolata',
    family: '"Inconsolata", monospace',
    weights: [300, 400, 500, 600, 700],
    bundled: false,
  },
  {
    id: 'commit-mono',
    label: 'Commit Mono',
    family: '"Commit Mono", monospace',
    weights: [400],
    bundled: false,
  },
  {
    id: 'comic-mono',
    label: 'Comic Mono',
    family: '"Comic Mono", monospace',
    weights: [400],
    bundled: false,
  },
];

/** Track which lazy fonts have been loaded */
const loadedFonts = new Set<FontId>(['ibm-plex-mono']);

/** Track in-flight loads */
const loadingFonts = new Map<FontId, Promise<void>>();

function loadSavedFont(): FontId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && fontOptions.some((f) => f.id === stored)) {
      return stored as FontId;
    }
  } catch {
    /* ignored */
  }
  return 'ibm-plex-mono';
}

const activeFont = ref<FontId>(loadSavedFont());
const fontLoading = ref(false);

watch(activeFont, (id) => {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignored */
  }
  applyFont(id);
});

function applyFont(id: FontId) {
  const opt = fontOptions.find((f) => f.id === id);
  if (opt) {
    document.documentElement.style.setProperty('--drydock-font', opt.family);
    // Tailwind's `font-mono` utility resolves from this token.
    document.documentElement.style.setProperty('--font-mono', opt.family);
  }
}

/**
 * Lazy-load a non-bundled font by injecting a <link> tag for its CSS.
 * Font CSS files are served from /fonts/{id}/{weight}.css (vite public dir).
 */
async function loadFont(id: FontId): Promise<void> {
  if (loadedFonts.has(id)) return;

  const existing = loadingFonts.get(id);
  if (existing) return existing;

  const opt = fontOptions.find((f) => f.id === id);
  if (!opt) return;

  const promise = (async () => {
    fontLoading.value = true;
    try {
      const linkPromises = opt.weights.map(
        (weight) =>
          new Promise<void>((resolve, reject) => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = `/fonts/${id}/${weight}.css`;
            link.dataset.font = id;
            link.onload = () => resolve();
            link.onerror = () => reject(new Error(`Failed to load font ${id} weight ${weight}`));
            document.head.appendChild(link);
          }),
      );
      await Promise.all(linkPromises);
      loadedFonts.add(id);
    } finally {
      loadingFonts.delete(id);
      fontLoading.value = false;
    }
  })();

  loadingFonts.set(id, promise);
  return promise;
}

async function setFont(id: FontId) {
  await loadFont(id);
  activeFont.value = id;
}

function isFontLoaded(id: FontId): boolean {
  return loadedFonts.has(id);
}

// Apply saved font on startup
applyFont(activeFont.value);
if (!loadedFonts.has(activeFont.value)) {
  loadFont(activeFont.value);
}

export function useFont() {
  return { activeFont, fontLoading, fontOptions, setFont, isFontLoaded, loadFont };
}
