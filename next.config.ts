import type { NextConfig } from "next";
import path from "node:path";

/**
 * Local dev opt-out for React Strict Mode. The watermark verification hook uses
 * persistent refs (`verificationStartedRef`, `verificationSessionKeyRef`,
 * `prewarmStartedRef`) to dedupe work; under dev-mode Strict Mode, components
 * mount → unmount → remount on initial mount, the cleanup sets `mounted = false`
 * in the in-flight `runVerification` closure, and the remount short-circuits via
 * the ref guards — so verification gets stuck on the frame_decode headline
 * forever. Strict Mode's double-mount is dev-only, so production / cloud builds
 * are unaffected either way.
 *
 * Run dev with `NEXT_DISABLE_STRICT_MODE=1 npm run dev:webpack` when iterating
 * on watermark playback locally. Mirrors the creator app's pattern.
 */
const strictModeDisabledForSession = process.env.NEXT_DISABLE_STRICT_MODE === "1";

const nextConfig: NextConfig = {
  ...(process.env.USE_STANDALONE_OUTPUT === "true" ? { output: "standalone" as const } : {}),
  reactStrictMode: !strictModeDisabledForSession,
  transpilePackages: ["@ffmpeg/ffmpeg", "@ffmpeg/util", "mp4box"],
  /**
   * Strip diagnostic console output from production builds. Keeps console.error
   * and console.warn so real failures still surface in the browser console for
   * debugging support cases. Removes console.log / console.info / console.debug
   * which are diagnostic only.
   *
   * Why this matters for perf: the watermark verification flow emits 30-50+
   * console.log calls per run (frame decode results, render state, phase
   * timings). Each call forces argument stringification and holds object
   * references, which can take 1-5ms per call when DevTools is open and
   * accumulates noticeable GC pressure on slower devices. More importantly,
   * production users shouldn't see internal phase names, frame counts, and
   * user IDs in their console.
   *
   * IMPORTANT: this is a build-time strip; verification logic is unchanged.
   * The cryptographic operations, frame decoding, RSA verify, and consensus
   * rules all run identically — they just stop emitting diagnostic output.
   */
  compiler: {
    removeConsole:
      process.env.NODE_ENV === "production"
        ? {exclude: ["error", "warn"]}
        : false,
  },
  async headers() {
    return [
      {
        source: "/embed/:path*",
        headers: [
          {key: "Access-Control-Allow-Origin", value: "*"},
          {key: "Access-Control-Allow-Methods", value: "GET, HEAD, OPTIONS"},
        ],
      },
    ];
  },
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
