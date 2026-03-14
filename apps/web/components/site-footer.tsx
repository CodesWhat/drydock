import { BookOpen, Github } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="px-4 py-8">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row">
        <div className="flex items-center gap-2 text-sm text-neutral-500">
          <Image
            src="/codeswhat-logo.png"
            alt="CodesWhat"
            width={20}
            height={20}
            className="dark:invert"
          />
          <span>&copy; {new Date().getFullYear()} CodesWhat. AGPL-3.0 License.</span>
        </div>
        <div className="flex items-center gap-4">
          <a
            href="https://github.com/CodesWhat/drydock"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full p-2 text-neutral-600 transition-colors hover:bg-neutral-200 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            aria-label="GitHub"
          >
            <Github className="h-5 w-5" />
          </a>
          <Link
            href="/docs"
            className="rounded-full p-2 text-neutral-600 transition-colors hover:bg-neutral-200 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            aria-label="Documentation"
          >
            <BookOpen className="h-5 w-5" />
          </Link>
        </div>
      </div>
    </footer>
  );
}
