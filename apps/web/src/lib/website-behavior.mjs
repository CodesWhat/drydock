export const THEME_FAMILIES = [
  { id: "one-dark", label: "One Dark" },
  { id: "github", label: "GitHub" },
  { id: "dracula", label: "Dracula" },
  { id: "catppuccin", label: "Catppuccin" },
  { id: "gruvbox", label: "Gruvbox" },
  { id: "ayu", label: "Ayu" },
];

export const FAMILY_KEY = "dd-website-family";
// A fixed string: it's inlined into the page, and a test keeps it in step with THEME_FAMILIES.
export const FAMILY_BOOTSTRAP = `(function(){try{var f=localStorage.getItem("dd-website-family");if(["one-dark","github","dracula","catppuccin","gruvbox","ayu"].includes(f))document.documentElement.dataset.family=f;}catch{}})();`;

export function getThemeFamily(value) {
  return THEME_FAMILIES.some((family) => family.id === value) ? value : "one-dark";
}

export function isDemoReadyMessage(event, frameWindow, demoUrl) {
  return Boolean(
    frameWindow &&
      event.source === frameWindow &&
      event.origin === new URL(demoUrl).origin &&
      event.data?.type === "drydock-demo-ready",
  );
}

export function splitRoadmap(rows, headVersion) {
  const newestFirst = [...rows].reverse();
  const head = newestFirst.findIndex((row) => row.version === headVersion);
  const cut = head < 0 ? newestFirst.length : head + 5;
  return { visible: newestFirst.slice(0, cut), earlier: newestFirst.slice(cut) };
}
