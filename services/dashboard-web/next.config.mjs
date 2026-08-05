/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The dashboard talks to the gateway server-side only; secrets never reach the browser.
  env: {},
};
export default nextConfig;
