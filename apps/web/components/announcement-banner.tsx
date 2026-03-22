"use client";

import { AlertTriangle, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

interface AnnouncementBannerProps {
  id: string;
  href: string;
  children: React.ReactNode;
}

export function AnnouncementBanner({ id, href, children }: AnnouncementBannerProps) {
  const storageKey = `dd-banner-dismissed-${id}`;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(storageKey)) {
      setVisible(true);
    }
  }, [storageKey]);

  if (!visible) return null;

  return (
    <div className="relative z-50 border-b border-amber-300/30 bg-amber-50 text-amber-900 dark:border-amber-700/30 dark:bg-amber-950/80 dark:text-amber-200">
      <div className="mx-auto flex max-w-7xl items-center justify-center gap-3 px-4 py-2.5 text-sm">
        <AlertTriangle className="hidden h-4 w-4 shrink-0 sm:block" />
        <Link href={href} className="font-medium underline-offset-2 hover:underline">
          {children}
        </Link>
        <button
          type="button"
          aria-label="Dismiss announcement"
          className="ml-2 shrink-0 rounded p-0.5 transition-colors hover:bg-amber-200/50 dark:hover:bg-amber-800/50"
          onClick={() => {
            localStorage.setItem(storageKey, "1");
            setVisible(false);
          }}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
