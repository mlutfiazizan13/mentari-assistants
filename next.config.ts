import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // patchright resolves its driver and browser registry through runtime path math
  // and dynamic requires that no bundler can trace. Keep it out of the server bundle.
  serverExternalPackages: ["patchright", "patchright-core"],
};

export default nextConfig;
