import type {Metadata} from "next";
import {Geist, Geist_Mono} from "next/font/google";
import {Toaster} from "@/components/ui/sonner";
import {FfmpegVerificationAssetPrewarm} from "@/components/video/FfmpegVerificationAssetPrewarm";
import {AuthProvider} from "@/contexts/AuthContext";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  // Disable preload — Geist Mono isn't used on /v/* or /embed/* (where load
  // perf matters most) and the default preload triggers "preloaded but not
  // used within a few seconds" warnings on those pages.
  preload: false,
});

export const metadata: Metadata = {
  title: "SAIVD Viewer",
  description: "Manage and view your video library",
};

// Wasabi origin assembled from env so preconnect points at the actual host the
// presigned URLs will use. Falls back to the generic s3.wasabisys.com domain if
// env vars aren't available at render time. Wrong/extra preconnect costs a few
// bytes of header + a wasted TLS handshake — harmless.
const WASABI_BUCKET = process.env.WASABI_BUCKET_NAME;
const WASABI_ENDPOINT = process.env.WASABI_ENDPOINT?.replace(/^https?:\/\//, "") ?? "s3.wasabisys.com";
const WASABI_ORIGIN = WASABI_BUCKET
  ? `https://${WASABI_BUCKET}.${WASABI_ENDPOINT}`
  : `https://${WASABI_ENDPOINT}`;
const SAIVD_API_ORIGIN = process.env.NEXT_PUBLIC_SAIVD_API_URL ?? "https://saivd.netlify.app";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* Open TLS connections to cross-origin hosts during HTML parse so the
            actual fetches don't pay for DNS + TCP + TLS handshakes serially.
            Saves ~150ms per host on cold loads. Costs ~0 if unused on a given page. */}
        <link rel="preconnect" href={SAIVD_API_ORIGIN} crossOrigin="anonymous" />
        <link rel="dns-prefetch" href={SAIVD_API_ORIGIN} />
        <link rel="preconnect" href={WASABI_ORIGIN} crossOrigin="anonymous" />
        <link rel="dns-prefetch" href={WASABI_ORIGIN} />
        {/* No <link rel="preload"> for ffmpeg-core.wasm. By spec, preload's
            credentials mode is constrained to "include" (no crossorigin) or
            "omit" (crossorigin="anonymous") or "include" (use-credentials);
            it cannot be "same-origin", which is what default fetch() uses for
            same-origin URLs. Any preload tag here will produce a credentials
            mismatch with FFmpeg's loader, the preload won't be used, and the
            WASM downloads twice. Use prewarmFfmpegVerificationAssets() instead
            (called on app shell mount) — it uses real fetch() which can be
            aligned with FFmpeg's loader. */}
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`} suppressHydrationWarning={true}>
        <AuthProvider>
          <FfmpegVerificationAssetPrewarm />
          {children}
          <Toaster />
        </AuthProvider>
      </body>
    </html>
  );
}
