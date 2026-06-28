import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { RootProvider } from "fumadocs-ui/provider/next";
import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { BASE_URL, SITE_CONFIG } from "@/lib/site-config";
import "./globals.css";

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

// Bump this whenever the favicon/app icons change so browsers re-fetch them
// instead of serving a stale cached icon (favicons cache aggressively).
const ICON_VERSION = "2";

export const metadata: Metadata = {
  title: {
    default: `${SITE_CONFIG.name} - ${SITE_CONFIG.tagline}`,
    template: `%s | ${SITE_CONFIG.name}`,
  },
  description: SITE_CONFIG.description,
  metadataBase: new URL(BASE_URL),
  openGraph: {
    title: `${SITE_CONFIG.name} - ${SITE_CONFIG.tagline}`,
    description: SITE_CONFIG.description,
    url: BASE_URL,
    siteName: SITE_CONFIG.name,
    locale: SITE_CONFIG.locale,
    type: "website",
    images: [
      {
        url: SITE_CONFIG.ogImage,
        width: 1200,
        height: 630,
        alt: `${SITE_CONFIG.name} - ${SITE_CONFIG.tagline}`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_CONFIG.name} - ${SITE_CONFIG.tagline}`,
    description: SITE_CONFIG.description,
    creator: SITE_CONFIG.twitterCreator,
    images: [SITE_CONFIG.ogImage],
  },
  icons: {
    icon: [
      { url: `/favicon.ico?v=${ICON_VERSION}`, sizes: "any" },
      { url: `/favicon-96x96.png?v=${ICON_VERSION}`, sizes: "96x96", type: "image/png" },
    ],
    apple: [{ url: `/apple-touch-icon.png?v=${ICON_VERSION}`, sizes: "180x180" }],
  },
  manifest: "/site.webmanifest",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

const REVEAL_BOOTSTRAP =
  "(function(){var d=document,de=d.documentElement;de.classList.add('js');var reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;function all(){var e=d.querySelectorAll('.reveal');for(var i=0;i<e.length;i++)e[i].classList.add('visible');}function arm(){if(reduce||!('IntersectionObserver' in window)){all();return;}var io=new IntersectionObserver(function(en){for(var i=0;i<en.length;i++){if(en[i].isIntersecting){en[i].target.classList.add('visible');io.unobserve(en[i].target);}}},{threshold:0.12,rootMargin:'0px 0px -40px 0px'});var e=d.querySelectorAll('.reveal');for(var i=0;i<e.length;i++)io.observe(e[i]);}if(d.readyState==='loading'){d.addEventListener('DOMContentLoaded',arm);}else{arm();}})();";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="apple-mobile-web-app-title" content={SITE_CONFIG.name} />
      </head>
      <body className={`${ibmPlexSans.className} ${ibmPlexMono.variable}`}>
        {/* Fail-open reveal gate: this inline script runs even if the bundled
            JS is blocked (e.g. SRI/CSP), adds `js` to <html> before sections
            paint, and runs a single IntersectionObserver. If JS never runs, the
            `.reveal` CSS defaults to visible. See globals.css. */}
        <script dangerouslySetInnerHTML={{ __html: REVEAL_BOOTSTRAP }} />
        <RootProvider>{children}</RootProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
