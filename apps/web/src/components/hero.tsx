import Image from "next/image";
import Link from "next/link";
import { CtaButtons } from "@/components/cta-buttons";
import { GitHubBadges } from "@/components/github-badges";
import { DOCS_ROOT, SITE_CONFIG } from "@/lib/site-config";

// "1.8.0-rc.10" -> "v1.8". The pill names the series, not the exact RC.
const rcSeries = `v${SITE_CONFIG.version.split(".").slice(0, 2).join(".")}`;

export function Hero() {
  return (
    <section className="website-hero" aria-labelledby="hero-heading">
      <div className="website-wrap">
        <div className="website-hero-grid">
          <div>
            <p className="website-version">
              v{SITE_CONFIG.stableVersion} <span>stable</span> <span aria-hidden="true">·</span>{" "}
              <Link
                href={`${DOCS_ROOT}/configuration/storage#upgrade-from-json`}
                className="underline underline-offset-4"
              >
                {rcSeries} RC <span>available to test</span>
              </Link>
            </p>
            <h1 id="hero-heading" className="website-display">
              Container Update <span>Monitoring</span>
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
