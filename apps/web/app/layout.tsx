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

export const metadata: Metadata = {
  title: "Drydock - Container Update Monitoring",
  description:
    "Open source container update monitoring built in TypeScript. Auto-discover containers, detect image updates, and trigger notifications across 20+ services.",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || "https://drydock.codeswhat.com",
  ),
  openGraph: {
    title: "Drydock - Container Update Monitoring",
    description:
      "Open source container update monitoring built in TypeScript. Auto-discover containers, detect image updates, and trigger notifications across 20+ services.",
    url: process.env.NEXT_PUBLIC_SITE_URL || "https://drydock.codeswhat.com",
    siteName: "Drydock",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Drydock - Container Update Monitoring",
    description:
      "Open source container update monitoring built in TypeScript. Auto-discover containers, detect image updates, and trigger notifications across 20+ services.",
    creator: "@codeswhat",
  },
  icons: {
    icon: [
      {
        url: "/favicon.svg",
        media: "(prefers-color-scheme: light)",
        type: "image/svg+xml",
      },
      {
        url: "/favicon.svg",
        media: "(prefers-color-scheme: dark)",
        type: "image/svg+xml",
      },
      {
        url: "/favicon.ico",
        sizes: "32x32",
      },
      {
        url: "/favicon-96x96.png",
        sizes: "96x96",
        type: "image/png",
      },
      {
        url: "/web-app-manifest-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        url: "/web-app-manifest-512x512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/site.webmanifest",
  alternates: {
    canonical:
      process.env.NEXT_PUBLIC_SITE_URL || "https://drydock.codeswhat.com",
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
