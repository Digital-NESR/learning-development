/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The nameplate PDF routes read the logo from disk; make sure Vercel bundles it.
  outputFileTracingIncludes: {
    "/api/nameplate": ["./public/assets/nesr-logo-white.png", "./public/assets/cpven-logo.png"],
    "/api/hooks/nameplate": ["./public/assets/nesr-logo-white.png", "./public/assets/cpven-logo.png"]
  }
};

export default nextConfig;
