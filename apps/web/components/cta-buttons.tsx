import { BookOpen } from "lucide-react";
import Link from "next/link";
import { GithubIcon } from "@/components/github-icon";
import { Button } from "@/components/ui/button";

export function CtaButtons() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
      <Button size="lg" asChild>
        <a href="https://github.com/CodesWhat/drydock" target="_blank" rel="noopener noreferrer">
          <GithubIcon className="h-4 w-4" />
          View on GitHub
        </a>
      </Button>
      <Button variant="outline" size="lg" asChild>
        <Link href="/docs">
          <BookOpen className="h-4 w-4" />
          Documentation
        </Link>
      </Button>
    </div>
  );
}
