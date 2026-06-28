import { BookOpen } from "lucide-react";
import Link from "next/link";
import { GithubIcon } from "@/components/github-icon";
import { Button } from "@/components/ui/button";
import { GITHUB_URL } from "@/lib/site-config";

export function CtaButtons({ align = "center" }: { align?: "center" | "start" } = {}) {
  const justifyClass = align === "start" ? "sm:justify-start" : "sm:justify-center";
  return (
    <div className={`grid w-full grid-cols-2 gap-3 sm:flex sm:w-auto sm:gap-4 ${justifyClass}`}>
      <Button size="lg" className="w-full sm:w-auto" asChild>
        <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
          <GithubIcon className="h-4 w-4" />
          View on GitHub
        </a>
      </Button>
      <Button variant="outline" size="lg" className="w-full sm:w-auto" asChild>
        <Link href="/docs">
          <BookOpen className="h-4 w-4" />
          Documentation
        </Link>
      </Button>
    </div>
  );
}
