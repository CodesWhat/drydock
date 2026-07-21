import { Terminal } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { SITE_CONFIG } from "@/lib/site-config";

type Props = {
  cardClassName?: string;
  contentClassName?: string;
  iconClassName?: string;
  headerClassName?: string;
  label?: string;
};

export function DockerRunSnippet({
  cardClassName = "border-neutral-200 bg-neutral-950 text-left dark:border-neutral-800",
  contentClassName = "pt-6",
  iconClassName = "h-4 w-4",
  headerClassName = "mb-3 flex items-center gap-2 text-neutral-500",
  label = "Terminal",
}: Props) {
  return (
    <Card className={cardClassName}>
      <CardContent className={contentClassName}>
        <div className={headerClassName}>
          <Terminal className={iconClassName} />
          <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
        </div>
        <pre className="overflow-x-auto text-sm">
          <code className="text-neutral-300">
            <span className="text-neutral-500">$</span>{" "}
            <span className="text-[#C4FF00]">docker run</span> -d \{"\n"}
            {"  "}--name drydock \{"\n"}
            {"  "}-v /var/run/docker.sock:/var/run/docker.sock \{"\n"}
            {"  "}-p 3000:3000 \{"\n"}
            {"  "}-e DD_ANONYMOUS_AUTH_CONFIRM=true \{"\n"}
            {"  "}
            {SITE_CONFIG.dockerImage}
            {"  "}
            <span className="text-neutral-600">
              # open dashboard — add real auth before exposing this
            </span>
          </code>
        </pre>
      </CardContent>
    </Card>
  );
}
