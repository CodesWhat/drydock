"use client";

import { Moon, Sun } from "lucide-react";
import Image from "next/image";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

type Screenshot = {
  srcLight: string;
  srcDark: string;
  alt: string;
  label: string;
};

export function ScreenshotsSection({ screenshots }: { screenshots: Screenshot[] }) {
  const { resolvedTheme } = useTheme();
  const [mode, setMode] = useState<"light" | "dark" | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const effectiveMode = mounted ? (mode ?? (resolvedTheme === "dark" ? "dark" : "light")) : "light";

  return (
    <section className="px-4 py-24">
      <div className="mx-auto max-w-6xl">
        <div className="relative mb-12 text-center">
          <div className="pointer-events-none absolute inset-y-[-1.5rem] left-1/2 w-[30rem] max-w-full -translate-x-1/2 bg-[radial-gradient(ellipse_at_center,_white_20%,_transparent_50%)] dark:bg-[radial-gradient(ellipse_at_center,_rgb(10,10,10)_20%,_transparent_50%)]" />
          <h2 className="relative mb-4 text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl dark:text-neutral-50">
            See it in action
          </h2>
          <p className="relative mx-auto max-w-2xl text-neutral-600 dark:text-neutral-400">
            A modern, responsive dashboard with dark mode support and rich container management.
          </p>
        </div>

        {/* Light/Dark Toggle */}
        {mounted && (
          <div className="mb-8 flex justify-center">
            <div className="inline-flex items-center rounded-lg border border-neutral-200 bg-white/50 p-1 backdrop-blur-sm dark:border-neutral-800 dark:bg-neutral-900/50">
              <button
                type="button"
                onClick={() => setMode(effectiveMode === "light" ? null : "light")}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  effectiveMode === "light"
                    ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                    : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                }`}
              >
                <Sun className="h-3.5 w-3.5" />
                Light
              </button>
              <button
                type="button"
                onClick={() => setMode(effectiveMode === "dark" ? null : "dark")}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  effectiveMode === "dark"
                    ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                    : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                }`}
              >
                <Moon className="h-3.5 w-3.5" />
                Dark
              </button>
            </div>
          </div>
        )}

        <div className="grid gap-6 sm:grid-cols-2">
          {screenshots.map((screenshot) => (
            <div key={screenshot.label} className="group">
              <div className="isolate overflow-hidden rounded-xl border border-neutral-200 bg-white/50 shadow-sm backdrop-blur-sm transition-all duration-300 group-hover:shadow-lg group-hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900/50 dark:group-hover:border-neutral-700">
                <div className="relative aspect-video overflow-hidden">
                  {mounted && (
                    <Image
                      key={`${screenshot.label}-${effectiveMode}`}
                      src={effectiveMode === "dark" ? screenshot.srcDark : screenshot.srcLight}
                      alt={screenshot.alt}
                      fill
                      className="object-cover object-left-top transition-transform duration-500 group-hover:scale-105"
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    />
                  )}
                </div>
                <div className="px-4 py-3">
                  <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                    {screenshot.label}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
