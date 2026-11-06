/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // These routes read logos and L&D's templates from disk; make sure Vercel bundles them.
  outputFileTracingIncludes: {
    "/api/certificates": ["./templates/cert-*"],
    "/api/attendance-sheet": ["./templates/attendance-*"],
    "/api/export/attendance": ["./public/assets/nesr-logo-white.png"],
    "/api/nameplate": ["./public/assets/nesr-logo-white.png", "./public/assets/cpven-logo.png"],
    "/api/hooks/nameplate": ["./public/assets/nesr-logo-white.png", "./public/assets/cpven-logo.png"]
  }
};

export default nextConfig;
