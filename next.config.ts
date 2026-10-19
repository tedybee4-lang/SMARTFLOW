import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  /* SMARTFLOW: cacheComponents off — dashboard/admin are authenticated dynamic routes */
  /* Wire Tailwind v4 into Turbopack (Next 16 default bundler) so utilities are generated */
  turbopack: {
    // Anchor Turbopack at this project even when npm is invoked via --prefix
    // from the parent chat workspace (avoids the "outside current Git repo" warning).
    root: projectRoot,
    rules: {
      "*.css": [{ loader: "@tailwindcss/turbopack" }],
    },
  },
};

export default nextConfig;
