import { BookOpen } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { DiscordIcon } from "@/components/discord-icon";
import { GithubIcon } from "@/components/github-icon";
import { TrackedLink } from "@/components/tracked-link";
import type { AnalyticsCtaId } from "@/lib/analytics-contract";
import {
  DEMO_URL,
  DOCS_ROOT,
  GITHUB_RELEASES_URL,
  GITHUB_URL,
  SITE_CONFIG,
} from "@/lib/site-config";

type FooterLink = { label: string; href: string; external?: boolean; ctaId?: AnalyticsCtaId };
const productLinks: FooterLink[] = [
  { label: "Documentation", href: DOCS_ROOT, ctaId: "docs_root" },
  { label: "Live demo", href: DEMO_URL, external: true },
  { label: "Compare", href: "/compare" },
  { label: "Security advisory", href: "/security/trivy-supply-chain-march-2026" },
];
const projectLinks: FooterLink[] = [
  { label: "GitHub", href: GITHUB_URL, external: true, ctaId: "github_repository" },
  { label: "Releases", href: GITHUB_RELEASES_URL, external: true },
  { label: "License", href: SITE_CONFIG.licenseUrl, external: true },
  { label: "Sponsor", href: "https://github.com/sponsors/CodesWhat", external: true },
  { label: "Discord", href: SITE_CONFIG.discordUrl, external: true, ctaId: "community_discord" },
];
const compareLinks: FooterLink[] = [
  { label: "All comparisons", href: "/compare" },
  ...[
    "Arcane",
    "Portainer",
    "Komodo",
    "Diun",
    "Dockge",
    "Dockhand",
    "Dozzle",
    "WUD",
    "Watchtower",
    "Ouroboros",
  ].map((name) => ({ label: `${name} vs Drydock`, href: `/compare/${name.toLowerCase()}` })),
];
const securityLinks: FooterLink[] = [
  { label: "Trivy supply chain compromise", href: "/security/trivy-supply-chain-march-2026" },
  { label: "Hardening guide", href: `${DOCS_ROOT}/guides/security` },
];

function FooterLinkEl({ link }: { link: FooterLink }) {
  const external = {
    target: link.external ? "_blank" : undefined,
    rel: link.external ? "noopener noreferrer" : undefined,
  };
  if (link.ctaId)
    return (
      <TrackedLink href={link.href} ctaId={link.ctaId} placement="footer" {...external}>
        {link.label}
      </TrackedLink>
    );
  return link.external ? (
    <a href={link.href} {...external}>
      {link.label}
    </a>
  ) : (
    <Link href={link.href}>{link.label}</Link>
  );
}

function LinkColumn({ heading, links }: { heading: string; links: FooterLink[] }) {
  return (
    <div>
      <p className="website-eyebrow">{heading}</p>
      <ul>
        {links.map((link) => (
          <li key={link.label}>
            <FooterLinkEl link={link} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Footer({ maxWidthClassName = "" }: { maxWidthClassName?: string }) {
  return (
    <footer className="website-footer">
      <div className={`website-wrap ${maxWidthClassName}`}>
        <div className="website-footer-grid">
          <div>
            <Link href="/" className="website-brand">
              <Image src="/whale.webp" alt="" width={39} height={26} loading="lazy" />
              <span>Drydock</span>
            </Link>
            <p className="website-footer-blurb">
              Open-source Docker container update monitor. Know when your stack needs attention,
              before it bites you.
            </p>
            <div className="website-footer-social">
              <TrackedLink
                href={GITHUB_URL}
                ctaId="github_repository"
                placement="footer"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="GitHub"
              >
                <GithubIcon className="h-5 w-5" />
              </TrackedLink>
              <TrackedLink
                href={SITE_CONFIG.discordUrl}
                ctaId="community_discord"
                placement="footer"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Discord community"
              >
                <DiscordIcon className="h-5 w-5" />
              </TrackedLink>
              <TrackedLink
                href={DOCS_ROOT}
                ctaId="docs_root"
                placement="footer"
                aria-label="Documentation"
              >
                <BookOpen size={18} />
              </TrackedLink>
            </div>
          </div>
          <LinkColumn heading="Product" links={productLinks} />
          <LinkColumn heading="Project" links={projectLinks} />
          <LinkColumn heading="Compare" links={compareLinks} />
          <LinkColumn heading="Security" links={securityLinks} />
        </div>
        <div className="website-footer-bottom">
          <p>
            © {new Date().getFullYear()} CodesWhat. Released under the{" "}
            <a href={SITE_CONFIG.licenseUrl}>MIT License</a>.
          </p>
          <a href="https://codeswhat.com" target="_blank" rel="noopener noreferrer">
            Small, sharp tools from one developer and a lot of agents.
          </a>
        </div>
      </div>
    </footer>
  );
}
