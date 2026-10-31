import { ArrowUpRight } from "lucide-react";
import Image from "next/image";
import { SectionHeading } from "@/components/section-heading";
import { SITE_CONFIG } from "@/lib/site-config";

const GH = "https://github.com/CodesWhat";

type Project = {
  name: string;
  tagline: string;
  blurb: string;
  light: string;
  href: string | null;
  current?: boolean;
  box: string;
};

const PROJECTS: Project[] = [
  {
    name: SITE_CONFIG.name,
    tagline: "Container update monitoring",
    blurb: "Watches every container you run and flags what's outdated or exposed — on your terms.",
    light: "/whale.webp",
    box: "h-[4.8rem] w-[7.2rem]",
    href: null,
    current: true,
  },
  {
    name: "sockguard",
    tagline: "Scoped Docker socket proxy",
    blurb:
      "Default-deny access to the Docker socket. Give Drydock least privilege instead of the raw socket.",
    light: "/sockguard.webp",
    box: "h-24 w-24",
    href: `${GH}/sockguard`,
  },
  {
    name: "portwing",
    tagline: "Secure remote Docker agent",
    blurb:
      "Authenticated edge agent. Run watchers and triggers across remote hosts over one signed wire contract.",
    light: "/portwing.webp",
    box: "h-24 w-24",
    href: `${GH}/portwing`,
  },
];

const SUB =
  "Drydock is one piece of a small, focused toolkit — each tool does one job, and they compose.";

const CARD =
  "rounded-[4px] border border-[var(--dd-border-strong)] bg-[var(--dd-bg-card)] border-[var(--dd-border-strong)] bg-[var(--dd-bg-card)]";

function Mascot({ p, box }: { p: Project; box: string }) {
  return (
    <span className={`relative block shrink-0 ${box}`}>
      <Image
        src={p.light}
        alt={p.name}
        width={128}
        height={128}
        className="h-full w-full object-contain"
        loading="lazy"
      />
    </span>
  );
}

function HereChip() {
  return (
    <span className="text-lg leading-none" role="img" aria-label="You're here">
      📍
    </span>
  );
}

function Arrow() {
  return (
    <ArrowUpRight className="h-4 w-4 shrink-0 text-[var(--tx-sec)] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
  );
}

export function Ecosystem() {
  return (
    <section className="website-section website-section--centered">
      <div className="website-wrap">
        <SectionHeading
          eyebrow="Ecosystem"
          title="Part of the CodesWhat stack"
          subtitle={SUB}
          align="left"
        />
        <div className={`${CARD} p-8`}>
          <div className="grid gap-8 sm:grid-cols-3">
            {PROJECTS.map((p) => {
              const body = (
                <>
                  <div className="flex h-28 items-center justify-center">
                    <Mascot p={p} box={p.box} />
                  </div>
                  <div className="mt-4 flex items-center gap-2">
                    <span className="font-mono text-base font-semibold text-[var(--dd-text)] dark:text-[var(--dd-text)]">
                      {p.name}
                    </span>
                    {p.current ? <HereChip /> : <Arrow />}
                  </div>
                  <p className="mt-1 text-xs text-[var(--tx-sec)] dark:text-[var(--tx-sec)]">
                    {p.tagline}
                  </p>
                </>
              );
              return p.href ? (
                <a
                  key={p.name}
                  href={p.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex flex-col items-center text-center"
                >
                  {body}
                </a>
              ) : (
                <div key={p.name} className="flex flex-col items-center text-center">
                  {body}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
