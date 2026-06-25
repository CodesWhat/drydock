"use client";

import Link from "next/link";

export type BgPalette = "ember" | "ocean" | "violet" | "forest" | "mono";

const palettes: { id: BgPalette; label: string; dot: string }[] = [
  { id: "ember", label: "Ember", dot: "bg-orange-500" },
  { id: "ocean", label: "Ocean", dot: "bg-sky-500" },
  { id: "violet", label: "Violet", dot: "bg-violet-500" },
  { id: "forest", label: "Forest", dot: "bg-emerald-500" },
  { id: "mono", label: "Mono", dot: "bg-slate-400" },
];

export function BgSwitcher({ active }: { active: BgPalette }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex gap-1 rounded-xl border border-border/70 bg-background/70 px-1.5 py-1.5 shadow-sm backdrop-blur-md">
      {palettes.map(({ id, label, dot }) => (
        <Link
          key={id}
          href={`?bg=${id}`}
          scroll={false}
          className={[
            "flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
            active === id
              ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
              : "text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100",
          ].join(" ")}
        >
          <span className={`h-2 w-2 rounded-full ${dot}`} />
          {label}
        </Link>
      ))}
    </div>
  );
}
