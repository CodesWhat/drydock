"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ComponentProps, forwardRef, type MouseEventHandler } from "react";
import { captureCta } from "@/lib/analytics";
import type { AnalyticsCtaId, AnalyticsCtaPlacement } from "@/lib/analytics-contract";

type TrackedLinkProps = Omit<ComponentProps<typeof Link>, "href" | "onClick"> & {
  href: string;
  ctaId: AnalyticsCtaId;
  placement: AnalyticsCtaPlacement;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
};

export const TrackedLink = forwardRef<HTMLAnchorElement, TrackedLinkProps>(function TrackedLink(
  { ctaId, placement, onClick, ...props },
  ref,
) {
  const pathname = usePathname();

  const handleClick: MouseEventHandler<HTMLAnchorElement> = (event) => {
    onClick?.(event);
    if (!event.defaultPrevented) {
      captureCta(pathname, ctaId, placement);
    }
  };

  return (
    <Link
      {...props}
      ref={ref}
      onClick={handleClick}
      data-analytics-cta={ctaId}
      data-analytics-placement={placement}
    />
  );
});
