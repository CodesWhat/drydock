import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const nextConfig = {
  crossOrigin: "anonymous",
  experimental: {
    sri: {
      algorithm: "sha384",
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "img.shields.io",
      },
    ],
  },
};

export default withMDX(nextConfig);
