import { ArrowUpRight } from "lucide-react";
import Image from "next/image";
import { SectionHeading } from "@/components/section-heading";

// Locked: Ecosystem = family lineup — the CodesWhat mascot family
// (whale · pitbull · pigeon) in one panel, each with a light + dark logo.

const GH = "https://github.com/CodesWhat";

type Project = {
  name: string;
  tagline: string;
  blurb: string;
  light: string;
  dark: string;
  href: string | null;
  current?: boolean;
  invert?: boolean;
  box: string;
};

const PROJECTS: Project[] = [
  {
    name: "Drydock",
    tagline: "Container update monitoring",
    blurb: "Watches every container you run and flags what's outdated or exposed — on your terms.",
    light: "/whale-logo.png",
    dark: "/whale-logo.png",
    box: "h-[4.8rem] w-[7.2rem]",
    href: null,
    current: true,
    invert: true,
  },
  {
    name: "sockguard",
    tagline: "Scoped Docker socket proxy",
    blurb:
      "Default-deny access to the Docker socket. Give Drydock least privilege instead of the raw socket.",
    light: "/sockguard-logo.png",
    dark: "/sockguard-logo-dark.png",
    box: "h-24 w-24",
    href: `${GH}/sockguard`,
  },
  {
    name: "portwing",
    tagline: "Secure remote Docker agent",
    blurb:
      "Authenticated edge agent. Run watchers and triggers across remote hosts over one signed wire contract.",
    light: "/portwing-logo.png",
    dark: "/portwing-logo-dark.png",
    box: "h-24 w-24",
    href: `${GH}/portwing`,
  },
];

const SUB =
  "Drydock is one piece of a small, focused toolkit — each tool does one job, and they compose.";

const CARD =
  "rounded-2xl border border-neutral-200 bg-white/50 backdrop-blur-sm dark:border-neutral-800 dark:bg-neutral-900/50";

function Mascot({ p, box }: { p: Project; box: string }) {
  // The whale has no separate dark logo — invert it like the hero/footer do.
  if (p.invert) {
    return (
      <span className={`relative block shrink-0 ${box}`}>
        <Image
          src={p.light}
          alt={p.name}
          width={128}
          height={128}
          className="h-full w-full object-contain drop-shadow-sm dark:invert"
        />
      </span>
    );
  }
  return (
    <span className={`relative block shrink-0 ${box}`}>
      <Image
        src={p.light}
        alt={p.name}
        width={128}
        height={128}
        className="h-full w-full object-contain drop-shadow-sm dark:hidden"
      />
      <Image
        src={p.dark}
        alt=""
        aria-hidden="true"
        width={128}
        height={128}
        className="hidden h-full w-full object-contain drop-shadow-sm dark:block"
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
    <ArrowUpRight className="h-4 w-4 shrink-0 text-neutral-400 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
  );
}

export function EcosystemVariants() {
  return (
    <section className="border-t border-border/60 px-4 py-16">
      <div className="mx-auto max-w-5xl px-4">
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
                    <span className="font-mono text-base font-semibold text-neutral-900 dark:text-neutral-100">
                      {p.name}
                    </span>
                    {p.current ? <HereChip /> : <Arrow />}
                  </div>
                  <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{p.tagline}</p>
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
