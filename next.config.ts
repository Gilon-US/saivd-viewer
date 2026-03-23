import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  ...(process.env.USE_STANDALONE_OUTPUT === "true" ? { output: "standalone" as const } : {}),
  transpilePackages: ["@ffmpeg/ffmpeg", "@ffmpeg/util", "mp4box"],
  experimental: {
    // Add any experimental features here
  },
  webpack: (config, { isServer, webpack }) => {
    if (!isServer) {
      config.resolve = config.resolve ?? {};
      config.resolve.alias = {
        ...config.resolve.alias,
        "@ffmpeg/ffmpeg-esm": path.join(process.cwd(), "node_modules/@ffmpeg/ffmpeg/dist/esm"),
      };
      config.output = config.output ?? {};
      config.output.workerPublicPath = "/_next/";
      config.plugins = config.plugins ?? [];
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(
          /@ffmpeg[\\/]ffmpeg[\\/]dist[\\/]esm[\\/]worker\.js$/,
          path.resolve(process.cwd(), "src/lib/ffmpeg-inner-worker.ts")
        )
      );
    }
    return config;
  },
};

export default nextConfig;
