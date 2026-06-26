import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { RootProvider } from "fumadocs-ui/provider/next";
import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
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
  title: "Drydock - Container Update Monitoring",
  description:
    "Open source container update monitoring built in TypeScript. Auto-discover containers, detect image updates, and trigger notifications across 20+ services.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://getdrydock.com"),
  openGraph: {
    title: "Drydock - Container Update Monitoring",
    description:
      "Open source container update monitoring built in TypeScript. Auto-discover containers, detect image updates, and trigger notifications across 20+ services.",
    url: process.env.NEXT_PUBLIC_SITE_URL || "https://getdrydock.com",
    siteName: "Drydock",
    locale: "en_US",
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Drydock - Container Update Monitoring",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Drydock - Container Update Monitoring",
    description:
      "Open source container update monitoring built in TypeScript. Auto-discover containers, detect image updates, and trigger notifications across 20+ services.",
    creator: "@codeswhat",
    images: ["/og-image.png"],
  },
  icons: {
    icon: [
      { url: `/favicon.ico?v=${ICON_VERSION}`, sizes: "any" },
      { url: `/favicon-96x96.png?v=${ICON_VERSION}`, sizes: "96x96", type: "image/png" },
    ],
    apple: [{ url: `/apple-touch-icon.png?v=${ICON_VERSION}`, sizes: "180x180" }],
  },
  manifest: "/site.webmanifest",
  alternates: {
    canonical: process.env.NEXT_PUBLIC_SITE_URL || "https://getdrydock.com",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="apple-mobile-web-app-title" content="Drydock" />
      </head>
      <body className={`${ibmPlexSans.className} ${ibmPlexMono.variable}`}>
        <RootProvider>{children}</RootProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
