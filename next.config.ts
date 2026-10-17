import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* SMARTFLOW: cacheComponents off — dashboard/admin are authenticated dynamic routes */
  /* Wire Tailwind v4 into Turbopack (Next 16 default bundler) so utilities are generated */
  turbopack: {
    rules: {
      "*.css": [{ loader: "@tailwindcss/turbopack" }],
    },
  },
};

export default nextConfig;
