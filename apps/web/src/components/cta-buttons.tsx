import { BookOpen, Play } from "lucide-react";
import { GithubIcon } from "@/components/github-icon";
import { TrackedLink } from "@/components/tracked-link";
import { Button } from "@/components/ui/button";
import { DOCS_ROOT, GITHUB_URL } from "@/lib/site-config";

export function CtaButtons({
  align = "center",
  placement,
}: {
  align?: "center" | "start";
  placement: "hero" | "comparison";
}) {
  const justifyClass = align === "start" ? "justify-start" : "justify-center";
  return (
    <div className={`flex flex-wrap gap-3 ${justifyClass}`}>
      <Button size="lg" className="w-auto" asChild>
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
      <Button variant="outline" size="lg" className="w-auto" asChild>
        <TrackedLink href={DOCS_ROOT} ctaId="docs_root" placement={placement}>
          <BookOpen className="h-4 w-4" />
          Documentation
        </TrackedLink>
      </Button>
      {placement === "hero" ? (
        <Button variant="outline" size="lg" className="w-auto" asChild>
          <a href="#demo">
            <Play className="h-4 w-4" />
            Try the live demo
          </a>
        </Button>
      ) : null}
    </div>
  );
}
