"use client";

import { Moon, Palette, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { FAMILY_KEY, getThemeFamily, THEME_FAMILIES } from "@/lib/website-behavior.mjs";

const subscribeNoop = () => () => {};

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

  return (
    <details className="website-themes" ref={panel}>
      <summary aria-label="Choose colour theme">
        <Palette size={16} />
        <span>Theme</span>
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
