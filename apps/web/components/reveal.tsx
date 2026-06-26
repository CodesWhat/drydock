"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

export function Reveal({
  enabled = true,
  children,
  className,
}: {
  enabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [shown, setShown] = useState(!enabled);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled) {
      setShown(true);
      return;
    }
    setShown(false);
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            observer.disconnect();
          }
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -10% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled]);

  if (!enabled) {
    return <div className={className}>{children}</div>;
  }

  return (
    <div ref={ref} data-reveal={shown ? "shown" : "hidden"} className={className}>
      {children}
    </div>
  );
}
