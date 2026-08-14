import { BookOpen } from "lucide-react";
import { GithubIcon } from "@/components/github-icon";
import { TrackedLink } from "@/components/tracked-link";
import { Button } from "@/components/ui/button";
import { GITHUB_URL } from "@/lib/site-config";

export function CtaButtons({
  align = "center",
  placement,
}: {
  align?: "center" | "start";
  placement: "hero" | "comparison";
}) {
  const justifyClass = align === "start" ? "sm:justify-start" : "sm:justify-center";
  return (
    <div className={`grid w-full grid-cols-2 gap-3 sm:flex sm:w-auto sm:gap-4 ${justifyClass}`}>
      <Button size="lg" className="w-full sm:w-auto" asChild>
        <TrackedLink
          href={GITHUB_URL}
          ctaId="github_repository"
          placement={placement}
          target="_blank"
          rel="noopener noreferrer"
        >
          <GithubIcon className="h-4 w-4" />
          View on GitHub
        </TrackedLink>
      </Button>
      <Button variant="outline" size="lg" className="w-full sm:w-auto" asChild>
        <TrackedLink href="/docs" ctaId="docs_root" placement={placement}>
          <BookOpen className="h-4 w-4" />
          Documentation
        </TrackedLink>
      </Button>
    </div>
  );
}
