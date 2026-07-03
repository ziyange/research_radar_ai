/** @type {import('next').NextConfig} */
const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8010/api/v1";
const distDir = process.env.NODE_ENV === "development" ? ".next-dev" : ".next";

const nextConfig = {
  distDir,
  typedRoutes: false,
  devIndicators: false,
  experimental: {
    // Next 15.5 enables the app segment explorer in dev by default. In this
    // project it has caused stale dev-runtime chunks to crash before the app
    // renders, while adding no product value for local validation.
    devtoolSegmentExplorer: false,
  },
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${apiBaseUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
