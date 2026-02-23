"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Check, ChevronRight, Clock, Ellipsis } from "lucide-react";
import { useState } from "react";

type Milestone = {
  version: string;
  title: string;
  emoji: string;
  status: "released" | "next" | "planned";
  dotColor: string;
  items: string[];
};

export function RoadmapTimeline({ roadmap }: { roadmap: Milestone[] }) {
  // Only the latest released milestone stays expanded and is not collapsible
  const releasedIndices = roadmap
    .map((m, i) => (m.status === "released" ? i : -1))
    .filter((i) => i !== -1);
  const latestReleasedIdx = releasedIndices[releasedIndices.length - 1] ?? -1;

  const initialCollapsed = new Set<string>();
  for (const m of roadmap) {
    if (m.status !== "released") continue;
    const idx = roadmap.indexOf(m);
    if (idx !== latestReleasedIdx) {
      initialCollapsed.add(m.version);
    }
  }

  const [collapsed, setCollapsed] = useState<Set<string>>(initialCollapsed);

  function toggleCollapse(version: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(version)) {
        next.delete(version);
      } else {
        next.add(version);
      }
      return next;
    });
  }

  return (
    <section className="px-4 py-24">
      <div className="mx-auto max-w-4xl">
        <div className="relative mb-16 text-center">
          <div className="pointer-events-none absolute inset-y-[-1rem] left-1/2 w-[22rem] max-w-full -translate-x-1/2 bg-[radial-gradient(ellipse_at_center,_white_20%,_transparent_50%)] dark:bg-[radial-gradient(ellipse_at_center,_rgb(10,10,10)_20%,_transparent_50%)]" />
          <h2 className="relative mb-4 text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl dark:text-neutral-50">
            Roadmap
          </h2>
          <p className="relative mx-auto max-w-2xl text-neutral-600 dark:text-neutral-400">
            Where we&apos;ve been and where we&apos;re headed.
          </p>
        </div>

        {/* Timeline */}
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-6 top-4 bottom-0 w-px bg-gradient-to-b from-emerald-400 via-amber-400 via-purple-400 via-sky-400 via-orange-400 via-rose-400 via-indigo-400 via-teal-400 via-cyan-400 via-lime-400 via-fuchsia-400 via-violet-400 to-transparent sm:left-1/2 sm:-translate-x-px" />

          <div>
            {roadmap.map((milestone, index) => {
              const isLeft = index % 2 === 0;
              const isCollapsed = collapsed.has(milestone.version);
              const isCollapsible =
                milestone.status === "released" && index !== latestReleasedIdx;
              const prevCollapsed =
                index > 0 && collapsed.has(roadmap[index - 1].version);

              // Older released milestones fade towards greyscale
              // Distance 0 = latest released (full color), higher = more faded
              const releasedDistance =
                milestone.status === "released" ? latestReleasedIdx - index : 0;
              // 0 → 100% saturation, 1 → 60%, 2 → 30%, 3+ → 10%
              const dotSaturation =
                releasedDistance <= 0
                  ? undefined
                  : releasedDistance === 1
                    ? "saturate(60%)"
                    : releasedDistance === 2
                      ? "saturate(30%)"
                      : "saturate(10%)";
              const dotStyle = dotSaturation
                ? { filter: dotSaturation }
                : undefined;

              if (isCollapsed) {
                return (
                  <div
                    key={milestone.version}
                    className={`relative flex items-center gap-6 sm:gap-0 ${index === 0 ? "" : "mt-2"}`}
                  >
                    {/* Smaller dot */}
                    <div className="absolute left-6 z-10 -translate-x-1/2 sm:left-1/2">
                      <button
                        type="button"
                        onClick={() => toggleCollapse(milestone.version)}
                        aria-expanded={false}
                        style={dotStyle}
                        className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-2 text-xs font-bold transition-transform hover:scale-110 ${milestone.dotColor}`}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {/* Compact single-line card */}
                    <div
                      className={`ml-16 w-full sm:ml-0 sm:w-[calc(50%-2rem)] ${
                        isLeft ? "sm:mr-auto sm:pr-0" : "sm:ml-auto sm:pl-0"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => toggleCollapse(milestone.version)}
                        aria-expanded={false}
                        style={dotStyle}
                        className="flex w-full cursor-pointer items-center gap-3 rounded-lg border border-neutral-200 bg-white/50 px-4 py-2.5 text-left backdrop-blur-sm transition-colors hover:bg-white/80 dark:border-neutral-800 dark:bg-neutral-900/50 dark:hover:bg-neutral-900/80"
                      >
                        <Badge variant="default" className="text-xs shrink-0">
                          {milestone.version}
                        </Badge>
                        <span className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                          <span className="mr-1">{milestone.emoji}</span>
                          {milestone.title}
                        </span>
                        <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-neutral-400" />
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={milestone.version}
                  className={`relative flex items-start gap-6 sm:gap-0 ${index === 0 ? "" : prevCollapsed ? "mt-4" : "mt-12"}`}
                >
                  {/* Timeline dot */}
                  <div className="absolute left-6 z-10 -translate-x-1/2 sm:left-1/2">
                    {isCollapsible ? (
                      <button
                        type="button"
                        onClick={() => toggleCollapse(milestone.version)}
                        aria-expanded={true}
                        style={dotStyle}
                        className={`flex cursor-pointer items-center justify-center rounded-full border-2 text-xs font-bold transition-transform hover:scale-110 ${
                          releasedDistance >= 2 ? "h-8 w-8" : "h-10 w-10"
                        } ${milestone.dotColor}`}
                      >
                        <Check
                          className={
                            releasedDistance >= 2 ? "h-3.5 w-3.5" : "h-4 w-4"
                          }
                        />
                      </button>
                    ) : (
                      <div
                        className={`flex h-12 w-12 items-center justify-center rounded-full border-2 text-xs font-bold ${milestone.dotColor}`}
                      >
                        {milestone.status === "released" ? (
                          <Check className="h-5 w-5" />
                        ) : (
                          <Clock className="h-5 w-5" />
                        )}
                      </div>
                    )}
                  </div>

                  {/* Content card */}
                  <div
                    className={`ml-16 w-full sm:ml-0 sm:w-[calc(50%-2rem)] ${
                      isLeft ? "sm:mr-auto sm:pr-0" : "sm:ml-auto sm:pl-0"
                    }`}
                  >
                    <Card
                      className={`border-neutral-200 bg-white/50 backdrop-blur-sm dark:border-neutral-800 dark:bg-neutral-900/50 ${
                        milestone.status === "planned" ? "opacity-85" : ""
                      } ${isCollapsible ? "cursor-pointer transition-colors hover:bg-white/80 dark:hover:bg-neutral-900/80" : ""}`}
                      {...(isCollapsible
                        ? {
                            role: "button",
                            tabIndex: 0,
                            "aria-expanded": true,
                            onClick: () => toggleCollapse(milestone.version),
                            onKeyDown: (e: React.KeyboardEvent) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                toggleCollapse(milestone.version);
                              }
                            },
                          }
                        : {})}
                    >
                      <CardContent>
                        <div className="mb-3 flex items-center gap-3">
                          <Badge
                            variant={
                              milestone.status === "released"
                                ? "default"
                                : "secondary"
                            }
                            className="text-xs"
                          >
                            {milestone.version}
                          </Badge>
                          {milestone.status === "released" && (
                            <Badge
                              variant="outline"
                              className="text-xs text-green-700 border-green-300 dark:text-green-400 dark:border-green-800"
                            >
                              Released
                            </Badge>
                          )}
                          {milestone.status === "next" && (
                            <Badge
                              variant="outline"
                              className="text-xs text-amber-700 border-amber-300 dark:text-amber-400 dark:border-amber-800"
                            >
                              Up Next
                            </Badge>
                          )}
                        </div>
                        <h3 className="mb-3 font-semibold text-neutral-900 dark:text-neutral-100">
                          <span className="mr-1.5">{milestone.emoji}</span>
                          {milestone.title}
                        </h3>
                        <ul className="space-y-1.5">
                          {milestone.items.map((item) => (
                            <li
                              key={item}
                              className="flex items-start gap-2 text-sm text-neutral-600 dark:text-neutral-400"
                            >
                              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-neutral-400 dark:bg-neutral-600" />
                              {item}
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              );
            })}
          </div>

          {/* "And more" terminal dot */}
          <div className="relative mt-12 flex items-center gap-6 sm:gap-0">
            <div className="absolute left-6 z-10 -translate-x-1/2 sm:left-1/2">
              <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-dashed border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900">
                <Ellipsis className="h-5 w-5 text-neutral-400 dark:text-neutral-600" />
              </div>
            </div>
            <div className="ml-16 sm:ml-0 sm:w-[calc(50%-2rem)] sm:mr-auto">
              <p className="text-sm text-neutral-500 dark:text-neutral-500">
                And more to come&hellip;
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
