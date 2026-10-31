import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { AnalyticsPageview } from "@/components/analytics-pageview";
import { RootProvider } from "@/components/root-provider";
import { BASE_URL, SITE_CONFIG } from "@/lib/site-config";
import "./globals.css";
import "./website-skin.css";
import "./website.css";

// Bump this whenever the favicon/app icons change so browsers re-fetch them
// instead of serving a stale cached icon (favicons cache aggressively).
const ICON_VERSION = "3";

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
  "(function(){var d=document,de=d.documentElement;de.classList.add('js');var reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;var io=null;function see(n){if(n.__rv)return;n.__rv=1;if(io)io.observe(n);else n.classList.add('visible');}function scan(r){if(r.nodeType!==1)return;if(r.classList.contains('reveal'))see(r);var e=r.querySelectorAll('.reveal');for(var i=0;i<e.length;i++)see(e[i]);}function drop(r){if(r.nodeType!==1)return;var l=r.classList.contains('reveal')?[r]:[];var e=r.querySelectorAll('.reveal');for(var i=0;i<e.length;i++)l.push(e[i]);for(var k=0;k<l.length;k++){var n=l[k];if(n.__rv&&!n.isConnected){if(io)io.unobserve(n);n.__rv=0;}}}function arm(){if(!reduce&&'IntersectionObserver' in window){io=new IntersectionObserver(function(en){for(var i=0;i<en.length;i++){if(en[i].isIntersecting){en[i].target.classList.add('visible');io.unobserve(en[i].target);}}},{threshold:0.12,rootMargin:'0px 0px -40px 0px'});}scan(d.body);if('MutationObserver' in window){new MutationObserver(function(ms){for(var i=0;i<ms.length;i++){var a=ms[i].addedNodes;for(var j=0;j<a.length;j++)scan(a[j]);var x=ms[i].removedNodes;if(x)for(var m=0;m<x.length;m++)drop(x[m]);}}).observe(d.body,{childList:true,subtree:true});}}if(d.readyState==='loading'){d.addEventListener('DOMContentLoaded',arm);}else{arm();}})();";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="en" data-product="drydock" data-family="one-dark" suppressHydrationWarning>
      <head>
        <meta name="apple-mobile-web-app-title" content={SITE_CONFIG.name} />
        <link
          rel="preload"
          href="/fonts/ibm-plex-mono-latin-400-normal.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/instrument-serif-latin-400-normal.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body>
        {/* Fail-open reveal gate: this inline script runs even if the bundled
            JS is blocked (e.g. SRI/CSP), adds `js` to <html> before sections
            paint, and runs a single IntersectionObserver. A MutationObserver on
            <body> reveals `.reveal` nodes mounted later by client-side
            navigation, since this script doesn't re-run then. If JS never
            runs, the `.reveal` CSS defaults to visible. See globals.css. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: REVEAL_BOOTSTRAP }} />
        <RootProvider theme={{ nonce }}>{children}</RootProvider>
        <AnalyticsPageview />
      </body>
    </html>
  );
}
