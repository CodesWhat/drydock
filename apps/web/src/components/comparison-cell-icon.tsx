import { Check, Minus, X } from "lucide-react";

export type CellValue = "yes" | "partial" | "no";

const STATES = {
  yes: { Icon: Check, label: "Yes" },
  partial: { Icon: Minus, label: "Partial" },
  no: { Icon: X, label: "No" },
} as const;

/** 20px tinted square holding the glyph, coloured by the theme's status tokens. */
export function ComparisonCellChip({
  value,
  className = "",
}: {
  value: CellValue;
  className?: string;
}) {
  const { Icon } = STATES[value];
  return (
    <span className={`website-cell website-cell--${value} ${className}`} aria-hidden="true">
      <Icon size={14} strokeWidth={2.5} />
    </span>
  );
}

export function ComparisonCellIcon({ value }: { value: CellValue }) {
  return (
    <>
      <ComparisonCellChip value={value} />
      <span className="sr-only">{STATES[value].label}</span>
    </>
  );
}
