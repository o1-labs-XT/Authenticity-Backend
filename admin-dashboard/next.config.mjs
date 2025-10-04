/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    // Skip type checking during build - o1js has type definition issues
    ignoreBuildErrors: true,
  },
  // Exclude packages with top-level await from webpack bundling
  serverComponentsExternalPackages: ['o1js', 'authenticity-zkapp'],
  experimental: {
    serverComponentsExternalPackages: ['o1js', 'authenticity-zkapp'],
  },
};

export default nextConfig;