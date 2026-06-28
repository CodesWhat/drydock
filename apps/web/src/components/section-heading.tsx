import type { ReactNode } from "react";

type Align = "left" | "right";

export function SectionHeading({
  eyebrow,
  strike,
  title,
  subtitle,
  align = "left",
}: {
  eyebrow?: string;
  strike?: string;
  title: string;
  subtitle?: ReactNode;
  align?: Align;
}) {
  const isRight = align === "right";
  return (
    <div
      className={`mb-12 flex max-w-2xl flex-col ${
        isRight ? "ml-auto items-end text-right" : "items-start text-left"
      }`}
    >
      {strike ? (
        <p className="text-3xl font-bold tracking-tight text-neutral-400 line-through decoration-2 sm:text-4xl dark:text-neutral-600">
          {strike}
        </p>
      ) : null}
      {eyebrow ? (
        <p className="mb-2 font-mono text-xs font-semibold uppercase tracking-widest text-neutral-400 dark:text-neutral-500">
          {eyebrow}
        </p>
      ) : null}
      <h2 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100 sm:text-4xl">
        {title}
      </h2>
      {subtitle ? (
        <p className="mt-3 text-base text-neutral-600 dark:text-neutral-400">{subtitle}</p>
      ) : null}
    </div>
  );
}
