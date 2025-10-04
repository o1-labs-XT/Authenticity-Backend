/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Exclude packages with top-level await from webpack bundling
  experimental: {
    serverComponentsExternalPackages: ['o1js', 'authenticity-zkapp'],
  },
};

export default nextConfig;