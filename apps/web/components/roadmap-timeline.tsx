"use client";

import { Check, ChevronRight, Clock, Ellipsis } from "lucide-react";
import { type CSSProperties, type KeyboardEvent, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

type Milestone = {
  version: string;
  title: string;
  emoji: string;
  status: "released" | "next" | "planned";
  dotColor: string;
  items: string[];
};

type RoadmapTimelineProps = {
  roadmap: Milestone[];
};

type ToggleCollapse = (version: string) => void;

type RoadmapMilestoneRowProps = {
  milestone: Milestone;
  index: number;
  roadmap: Milestone[];
  latestReleasedIdx: number;
  collapsed: Set<string>;
  toggleCollapse: ToggleCollapse;
};

type CollapsedMilestoneRowProps = {
  milestone: Milestone;
  index: number;
  isLeft: boolean;
  dotStyle?: CSSProperties;
  toggleCollapse: ToggleCollapse;
};

type ExpandedMilestoneRowProps = {
  milestone: Milestone;
  index: number;
  isLeft: boolean;
  prevCollapsed: boolean;
  isCollapsible: boolean;
  releasedDistance: number;
  dotStyle?: CSSProperties;
  toggleCollapse: ToggleCollapse;
};

function getLatestReleasedIndex(roadmap: Milestone[]): number {
  for (let index = roadmap.length - 1; index >= 0; index -= 1) {
    if (roadmap[index].status === "released") {
      return index;
    }
  }

  return -1;
}

function getInitialCollapsed(roadmap: Milestone[], latestReleasedIdx: number): Set<string> {
  const initialCollapsed = new Set<string>();

  roadmap.forEach((milestone, index) => {
    if (milestone.status === "released" && index !== latestReleasedIdx) {
      initialCollapsed.add(milestone.version);
    }
  });

  return initialCollapsed;
}

function getReleasedDistance(
  status: Milestone["status"],
  index: number,
  latestReleasedIdx: number,
): number {
  return status === "released" ? latestReleasedIdx - index : 0;
}

function getDotStyle(releasedDistance: number): CSSProperties | undefined {
  if (releasedDistance <= 0) {
    return undefined;
  }

  if (releasedDistance === 1) {
    return { filter: "saturate(60%)" };
  }

  if (releasedDistance === 2) {
    return { filter: "saturate(30%)" };
  }

  return { filter: "saturate(10%)" };
}

function getCardInteractionProps(
  isCollapsible: boolean,
  version: string,
  toggleCollapse: ToggleCollapse,
) {
  if (!isCollapsible) {
    return {};
  }

  return {
    role: "button" as const,
    tabIndex: 0,
    "aria-expanded": true as const,
    onClick: () => toggleCollapse(version),
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleCollapse(version);
      }
    },
  };
}

function MilestoneStatusBadge({ status }: { status: Milestone["status"] }) {
  if (status === "released") {
    return (
      <Badge
        variant="outline"
        className="text-xs text-green-700 border-green-300 dark:text-green-400 dark:border-green-800"
      >
        Released
      </Badge>
    );
  }

  if (status === "next") {
    return (
      <Badge
        variant="outline"
        className="text-xs text-amber-700 border-amber-300 dark:text-amber-400 dark:border-amber-800"
      >
        Up Next
      </Badge>
    );
  }

  return null;
}

function CollapsedMilestoneRow({
  milestone,
  index,
  isLeft,
  dotStyle,
  toggleCollapse,
}: CollapsedMilestoneRowProps) {
  return (
    <div className={`relative flex items-center gap-6 sm:gap-0 ${index === 0 ? "" : "mt-2"}`}>
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

function ExpandedMilestoneRow({
  milestone,
  index,
  isLeft,
  prevCollapsed,
  isCollapsible,
  releasedDistance,
  dotStyle,
  toggleCollapse,
}: ExpandedMilestoneRowProps) {
  const compactReleasedDot = releasedDistance >= 2;
  const cardInteractionProps = getCardInteractionProps(
    isCollapsible,
    milestone.version,
    toggleCollapse,
  );

  return (
    <div
      className={`relative flex items-start gap-6 sm:gap-0 ${
        index === 0 ? "" : prevCollapsed ? "mt-4" : "mt-12"
      }`}
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
              compactReleasedDot ? "h-8 w-8" : "h-10 w-10"
            } ${milestone.dotColor}`}
          >
            <Check className={compactReleasedDot ? "h-3.5 w-3.5" : "h-4 w-4"} />
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
          } ${
            isCollapsible
              ? "cursor-pointer transition-colors hover:bg-white/80 dark:hover:bg-neutral-900/80"
              : ""
          }`}
          {...cardInteractionProps}
        >
          <CardContent>
            <div className="mb-3 flex items-center gap-3">
              <Badge
                variant={milestone.status === "released" ? "default" : "secondary"}
                className="text-xs"
              >
                {milestone.version}
              </Badge>
              <MilestoneStatusBadge status={milestone.status} />
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
}

function RoadmapMilestoneRow({
  milestone,
  index,
  roadmap,
  latestReleasedIdx,
  collapsed,
  toggleCollapse,
}: RoadmapMilestoneRowProps) {
  const isLeft = index % 2 === 0;
  const isCollapsed = collapsed.has(milestone.version);
  const isCollapsible = milestone.status === "released" && index !== latestReleasedIdx;
  const prevCollapsed = index > 0 && collapsed.has(roadmap[index - 1].version);
  const releasedDistance = getReleasedDistance(milestone.status, index, latestReleasedIdx);
  const dotStyle = getDotStyle(releasedDistance);

  if (isCollapsed) {
    return (
      <CollapsedMilestoneRow
        milestone={milestone}
        index={index}
        isLeft={isLeft}
        dotStyle={dotStyle}
        toggleCollapse={toggleCollapse}
      />
    );
  }

  return (
    <ExpandedMilestoneRow
      milestone={milestone}
      index={index}
      isLeft={isLeft}
      prevCollapsed={prevCollapsed}
      isCollapsible={isCollapsible}
      releasedDistance={releasedDistance}
      dotStyle={dotStyle}
      toggleCollapse={toggleCollapse}
    />
  );
}

export function RoadmapTimeline({ roadmap }: RoadmapTimelineProps) {
  // Only the latest released milestone stays expanded and is not collapsible
  const latestReleasedIdx = getLatestReleasedIndex(roadmap);
  const [collapsed, setCollapsed] = useState<Set<string>>(() =>
    getInitialCollapsed(roadmap, latestReleasedIdx),
  );

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
            {roadmap.map((milestone, index) => (
              <RoadmapMilestoneRow
                key={milestone.version}
                milestone={milestone}
                index={index}
                roadmap={roadmap}
                latestReleasedIdx={latestReleasedIdx}
                collapsed={collapsed}
                toggleCollapse={toggleCollapse}
              />
            ))}
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
