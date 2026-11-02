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
    <div className={`website-section-heading ${isRight ? "website-section-heading-right" : ""}`}>
      {strike ? <p className="website-section-strike">{strike}</p> : null}
      {eyebrow ? <p className="website-eyebrow">{eyebrow}</p> : null}
      <h2 className="website-section-title">{title}</h2>
      {subtitle ? <p className="website-section-subtitle">{subtitle}</p> : null}
    </div>
  );
}
