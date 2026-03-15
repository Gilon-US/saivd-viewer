/**
 * WebCodecs + web-demuxer (WASM) frame 0 luma extraction for watermark verification.
 * Per THIRD_PARTY_NEXTJS_APP_IMPLEMENTATION_GUIDE: Range fetch → File → WebDemuxer.load →
 * getDecoderConfig('video'), seek('video', 0) → decode one frame → extract Y plane (I420/NV12) → crop to 16.
 * Expects faststart MP4; WASM must be served at origin/wasm/web-demuxer.wasm.
 */

const RANGE_SIZES = [8 * 1024 * 1024, 16 * 1024 * 1024] as const; // 8 MB, then 16 MB per guide §3.3
const PATCH_SIZE = 16;

/** Fallback H.264 codec strings if VideoDecoder.isConfigSupported rejects the demuxer config codec. */
const AVC1_FALLBACK_CODECS = ["avc1.42E01E", "avc1.4d401f", "avc1.4d001f", "avc1.64001f", "avc1.640028"];

export type Frame0LumaResult = {
  luma: Uint8Array;
  width: number;
  height: number;
};

/**
 * WebCodecs support check per guide §3.2: VideoDecoder, EncodedVideoChunk, VideoFrame must exist.
 */
export function isWebCodecsSupported(): boolean {
  if (typeof globalThis === "undefined") return false;
  const g = globalThis as unknown as {
    VideoDecoder?: unknown;
    EncodedVideoChunk?: unknown;
    VideoFrame?: unknown;
  };
  return (
    typeof g.VideoDecoder !== "undefined" &&
    typeof g.EncodedVideoChunk !== "undefined" &&
    typeof g.VideoFrame !== "undefined"
  );
}

/**
 * Returns the absolute WASM URL for web-demuxer (browser only). Use in client-side frame-0 capture only.
 */
export function getWebDemuxerWasmUrl(): string {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}/wasm/web-demuxer.wasm`;
}

/**
 * Decode a single frame per guide §3.5: first frame resolves the Promise; extra frames get frame.close(); null if flush completes without output.
 */
function decodeOneFrame(
  config: VideoDecoderConfig,
  chunk: EncodedVideoChunk
): Promise<VideoFrame | null> {
  return new Promise((resolve, reject) => {
    let resolved = false;
    const decoder = new VideoDecoder({
      output: (frame: VideoFrame) => {
        if (!resolved) {
          resolved = true;
          resolve(frame);
        } else {
          frame.close();
        }
      },
      error: (e: Error) => {
        if (!resolved) {
          resolved = true;
          reject(e);
        }
      },
    });
    decoder.configure(config);
    decoder.decode(chunk);
    decoder
      .flush()
      .then(() => {
        if (!resolved) {
          resolved = true;
          resolve(null);
        }
      })
      .catch((e) => {
        if (!resolved) {
          resolved = true;
          reject(e);
        }
      })
      .finally(() => {
        decoder.close();
      });
  });
}

/**
 * Extract Y plane from VideoFrame per guide §3.6: codedWidth/codedHeight, format I420 or NV12, layout from copyTo (plane 0), stride-aware copy, crop to multiple of 16.
 */
function extractYPlaneAndCrop(frame: VideoFrame): Frame0LumaResult | null {
  const width = frame.codedWidth;
  const height = frame.codedHeight;
  if (width <= 0 || height <= 0) return null;

  const format = (frame as VideoFrame & { format?: string }).format;
  if (format !== "I420" && format !== "NV12") {
    console.warn("[webcodecs-diagnostic] VideoFrame format not I420/NV12", { format });
    return null;
  }

  const allocSize = frame.allocationSize();
  const buffer = new Uint8Array(allocSize);
  const layoutResult = frame.copyTo(buffer);
  frame.close();

  const planes = Array.isArray(layoutResult)
    ? layoutResult
    : (layoutResult as { layout?: { offset: number; stride: number }[] })?.layout;
  const yOffset = planes?.[0]?.offset ?? 0;
  const yStride = planes?.[0]?.stride ?? width;

  const yPlane = new Uint8Array(width * height);
  if (yStride === width) {
    yPlane.set(buffer.subarray(yOffset, yOffset + width * height));
  } else {
    for (let row = 0; row < height; row++) {
      yPlane.set(
        buffer.subarray(yOffset + row * yStride, yOffset + row * yStride + width),
        row * width
      );
    }
  }

  const cropW = width - (width % PATCH_SIZE);
  const cropH = height - (height % PATCH_SIZE);
  if (cropW <= 0 || cropH <= 0) return null;

  const croppedLuma = new Uint8Array(cropW * cropH);
  for (let y = 0; y < cropH; y++) {
    for (let x = 0; x < cropW; x++) {
      croppedLuma[y * cropW + x] = yPlane[y * width + x];
    }
  }
  return { luma: croppedLuma, width: cropW, height: cropH };
}

/**
 * Ensure VideoDecoder accepts the config; try fallback avc1 codec strings if the demuxer's codec is rejected.
 */
async function ensureConfigSupported(
  config: VideoDecoderConfig
): Promise<VideoDecoderConfig | null> {
  const supported = await VideoDecoder.isConfigSupported(config);
  if (supported?.supported) return config;

  const codec = config.codec;
  if (!codec.startsWith("avc1.")) return null;
  const baseConfig = {
    codedWidth: config.codedWidth,
    codedHeight: config.codedHeight,
    ...(config.description ? { description: config.description } : {}),
  };
  for (const candidate of AVC1_FALLBACK_CODECS) {
    if (candidate === codec) continue;
    const s = await VideoDecoder.isConfigSupported({ ...baseConfig, codec: candidate });
    if (s?.supported) {
      console.log("[webcodecs-diagnostic] Using fallback codec for VideoDecoder", {
        from: codec,
        to: candidate,
      });
      return { ...baseConfig, codec: candidate } as VideoDecoderConfig;
    }
  }
  return null;
}

/**
 * Fetch the start of the video, demux with web-demuxer (WASM), decode frame 0 with VideoDecoder,
 * extract Y plane (I420/NV12), crop to multiple of 16. Returns null on any failure.
 * Per guide §3.7: try range sizes 8 MB then 16 MB; call demuxer.destroy() when done.
 */
export async function getFrame0LumaFromUrl(
  videoUrl: string,
  signal?: AbortSignal
): Promise<Frame0LumaResult | null> {
  if (!isWebCodecsSupported()) {
    console.log("[webcodecs-diagnostic] WebCodecs not supported; returning null");
    return null;
  }

  const wasmUrl = getWebDemuxerWasmUrl();
  if (!wasmUrl) {
    console.warn("[webcodecs-diagnostic] WASM URL not available (not in browser)");
    return null;
  }

  interface DemuxerHandle {
    load: (f: File) => Promise<void>;
    getDecoderConfig: (t: "video") => Promise<VideoDecoderConfig | null>;
    seek: (t: "video", time: number) => Promise<EncodedVideoChunk | null>;
    destroy: () => void;
  }

  for (const byteCount of RANGE_SIZES) {
    let demuxer: DemuxerHandle | null = null;
    try {
      if (signal?.aborted) return null;
      const res = await fetch(videoUrl, {
        mode: "cors",
        headers: { Range: `bytes=0-${byteCount - 1}` },
        signal,
      });
      if (!res.ok) {
        console.warn("[webcodecs-diagnostic] Range fetch not ok", {
          byteCount,
          status: res.status,
          statusText: res.statusText,
        });
        continue;
      }

      const buffer = await res.arrayBuffer();
      if (signal?.aborted) return null;
      const file = new File([buffer], "video.mp4", { type: "video/mp4" });

      const { WebDemuxer } = await import("web-demuxer");
      demuxer = new WebDemuxer({ wasmFilePath: wasmUrl }) as unknown as DemuxerHandle;
      await demuxer.load(file);
      if (signal?.aborted) return null;

      const config = await demuxer.getDecoderConfig("video");
      if (!config) {
        console.warn("[webcodecs-diagnostic] getDecoderConfig('video') returned null", {
          byteCount,
        });
        continue;
      }

      const chunk = await demuxer.seek("video", 0);
      if (!chunk) {
        console.warn("[webcodecs-diagnostic] seek('video', 0) returned null", { byteCount });
        continue;
      }

      const usableConfig = await ensureConfigSupported(config);
      if (!usableConfig) {
        console.warn("[webcodecs-diagnostic] VideoDecoder.isConfigSupported false for config", {
          codec: config.codec,
        });
        continue;
      }

      const frame = await decodeOneFrame(usableConfig, chunk);
      if (!frame) {
        console.warn("[webcodecs-diagnostic] decodeOneFrame returned null", { byteCount });
        continue;
      }

      const result = extractYPlaneAndCrop(frame);
      if (result) {
        console.log("[webcodecs-diagnostic] Frame 0 luma extracted", {
          width: result.width,
          height: result.height,
          byteCount,
        });
        return result;
      }
    } catch (e) {
      console.warn("[webcodecs-diagnostic] getFrame0LumaFromUrl attempt failed", {
        byteCount,
        err: e,
      });
    } finally {
      demuxer?.destroy();
    }
  }

  console.warn("[webcodecs-diagnostic] getFrame0LumaFromUrl failed for all range sizes");
  return null;
}
