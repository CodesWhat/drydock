import Image from "next/image";
import { CtaButtons } from "@/components/cta-buttons";
import { GitHubBadges } from "@/components/github-badges";
import { SITE_CONFIG } from "@/lib/site-config";

export function Hero() {
  return (
    <section className="website-hero" aria-labelledby="hero-heading">
      <div className="website-wrap">
        <div className="website-hero-grid">
          <div>
            <p className="website-version">
              v{SITE_CONFIG.version} <span>Open source</span>
            </p>
            <h1 id="hero-heading" className="website-display">
              Container Update<span>Monitoring</span>
            </h1>
            <p className="website-lede">
              Self-hosted and open source. Drydock watches every container you&apos;re running,
              flags what&apos;s outdated or exposed, and lets you roll out fixes on your terms.
            </p>
            <CtaButtons align="start" placement="hero" />
          </div>
          <div className="website-hero-mascot">
            <Image
              src="/whale.webp"
              alt="Drydock mascot, a blue toy whale"
              width={800}
              height={533}
              priority
            />
          </div>
        </div>
        <GitHubBadges />
      </div>
    </section>
  );
}
