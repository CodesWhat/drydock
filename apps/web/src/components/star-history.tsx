import { SectionHeading } from "@/components/section-heading";
import { GITHUB_URL, REPO_SLUG } from "@/lib/site-config";

// The site's mode follows the theme class, not the OS, so both charts render
// and CSS (.dark) shows one. No client JS and no fetch: the browser loads the
// hosted SVG, which img-src in the CSP allows.
const CHART = `https://api.star-history.com/svg?repos=${encodeURIComponent(REPO_SLUG.toLowerCase())}&type=timeline&legend=top-left`;
const PAGE = `https://www.star-history.com/#${REPO_SLUG}&type=timeline&legend=top-left`;
const ALT = "Star history chart: GitHub stars for CodesWhat/drydock over time";

export function StarHistory() {
  return (
    <section className="website-section website-section--centered">
      <div className="website-wrap">
        <SectionHeading
          eyebrow="Community"
          title="Star history"
          subtitle={
            <>
              GitHub stars for{" "}
              <a href={GITHUB_URL} className="underline underline-offset-4">
                {REPO_SLUG}
              </a>{" "}
              over time.
            </>
          }
          align="left"
        />
        <a className="website-star-chart" href={PAGE} target="_blank" rel="noopener noreferrer">
          <img
            className="website-star-chart-light"
            src={CHART}
            alt={ALT}
            width={800}
            height={533}
            loading="lazy"
            decoding="async"
          />
          <img
            className="website-star-chart-dark"
            src={`${CHART}&theme=dark`}
            alt={ALT}
            width={800}
            height={533}
            loading="lazy"
            decoding="async"
          />
        </a>
      </div>
    </section>
  );
}
