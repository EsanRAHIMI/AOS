/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The dashboard talks to the gateway server-side only; secrets never reach the browser.
  env: {},
  async redirects() {
    return [
      // Jarvis is the product root; keep old bookmarks working.
      { source: '/jarvis', destination: '/', permanent: true },
    ];
  },
};
export default nextConfig;
