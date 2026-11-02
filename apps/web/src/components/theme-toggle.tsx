"use client";

import { Moon, Palette, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { FAMILY_KEY, getThemeFamily, THEME_FAMILIES } from "@/lib/website-behavior.mjs";

const subscribeNoop = () => () => {};

// Preview chips (surface, primary, text, accent) per family. They show each
// family's own palette before it is chosen, so they can't read the active
// theme's variables.
const SWATCHES: Record<string, [string, string, string, string]> = {
  "one-dark": ["#282c34", "#8ab0ff", "#fafafa", "#526fff"],
  github: ["#0d1117", "#58a6ff", "#ffffff", "#0969da"],
  dracula: ["#282a36", "#e1cffc", "#f8f8f2", "#7c5cbf"],
  catppuccin: ["#1e1e2e", "#89dceb", "#eff1f5", "#04a5e5"],
  gruvbox: ["#282828", "#fea962", "#fbf1c7", "#d65d0e"],
  ayu: ["#242936", "#ffcc66", "#fcfcfc", "#f29718"],
};

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
  const [family, setFamily] = useState("one-dark");
  const panel = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    setFamily(getThemeFamily(document.documentElement.dataset.family));
  }, []);

  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !panel.current?.contains(event.target)) {
        panel.current?.removeAttribute("open");
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && panel.current?.open) {
        panel.current.removeAttribute("open");
        panel.current.querySelector("summary")?.focus();
      }
    }
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  function chooseFamily(value: string) {
    const next = getThemeFamily(value);
    document.documentElement.dataset.family = next;
    setFamily(next);
    try {
      localStorage.setItem(FAMILY_KEY, next);
    } catch {
      // Theme switching still works when storage is unavailable.
    }
  }

  const familyLabel = THEME_FAMILIES.find((item) => item.id === family)?.label ?? "Theme";
  const summaryLabel = mounted && resolvedTheme ? `${familyLabel} · ${resolvedTheme}` : "Theme";

  return (
    <details className="website-themes" ref={panel}>
      <summary>
        <Palette size={16} aria-hidden="true" />
        <span>{summaryLabel}</span>
      </summary>
      <div className="website-theme-panel">
        <p className="website-eyebrow">Colour theme</p>
        <div className="website-theme-families">
          {THEME_FAMILIES.map((item) => (
            <button
              type="button"
              key={item.id}
              aria-pressed={family === item.id}
              onClick={() => chooseFamily(item.id)}
            >
              <span className="website-swatch" aria-hidden="true">
                {(SWATCHES[item.id] ?? []).map((color) => (
                  <i key={color} style={{ background: color }} />
                ))}
              </span>
              {item.label}
            </button>
          ))}
        </div>
        <div className="website-theme-modes">
          <button
            type="button"
            aria-pressed={mounted && resolvedTheme === "light"}
            onClick={() => setTheme("light")}
          >
            <Sun size={14} />
            Light
          </button>
          <button
            type="button"
            aria-pressed={mounted && resolvedTheme === "dark"}
            onClick={() => setTheme("dark")}
          >
            <Moon size={14} />
            Dark
          </button>
        </div>
        <p className="website-theme-note">
          The same six theme families as the app. Esc closes this panel.
        </p>
      </div>
    </details>
  );
}
