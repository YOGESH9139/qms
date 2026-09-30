/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allows a second dev server (e.g. for automated checks) without clobbering the main .next folder.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
