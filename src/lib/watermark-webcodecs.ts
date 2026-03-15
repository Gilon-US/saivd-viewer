/**
 * WebCodecs-based frame 0 luma extraction for watermark verification.
 * Fetches the start of the video via Range request, demuxes with mp4box,
 * decodes the first frame with VideoDecoder, and returns the Y plane (cropped to 16).
 * Use when available for best match to encoder codec Y; fall back to canvas otherwise.
 */

const RANGE_BYTES = 8 * 1024 * 1024; // 8 MB for faststart MP4
const PATCH_SIZE = 16;

export type Frame0LumaResult = {
  luma: Uint8Array;
  width: number;
  height: number;
};

/**
 * Check if WebCodecs VideoDecoder is available (browser only).
 */
export function isWebCodecsSupported(): boolean {
  return typeof globalThis !== "undefined" && typeof (globalThis as unknown as { VideoDecoder?: unknown }).VideoDecoder !== "undefined";
}

/**
 * Fetch the start of the video, demux to get the first video sample and codec config,
 * decode with VideoDecoder, and return the cropped Y plane for frame 0.
 * Returns null on any failure (unsupported codec, demux/decode error, or abort).
 */
export async function getFrame0LumaFromUrl(
  videoUrl: string,
  signal?: AbortSignal
): Promise<Frame0LumaResult | null> {
  if (!isWebCodecsSupported()) {
    return null;
  }

  try {
    const res = await fetch(videoUrl, {
      method: "GET",
      headers: { Range: `bytes=0-${RANGE_BYTES - 1}` },
      signal,
    });
    if (!res.ok) return null;

    const ab = await res.arrayBuffer();
    if (signal?.aborted) return null;

    const MP4Box = await import("mp4box");
    const file = MP4Box.createFile() as {
      onReady?: (info: { tracks: Array<{ id: number; codec: string; video?: { width: number; height: number } }> }) => void;
      onError?: (module: string, message: string) => void;
      onSamples?: (id: number, _user: unknown, samples: Array<{
        track_id: number;
        description?: unknown;
        is_rap?: boolean;
        timescale: number;
        dts: number;
        cts: number;
        duration: number;
        size: number;
        data: ArrayBuffer;
      }>) => void;
      appendBuffer: (buf: ArrayBuffer & { fileStart?: number }) => number;
      setExtractionOptions: (id: number, user: unknown, opts: { nbSamples: number }) => void;
      start: () => void;
      flush: () => void;
    };

    let resolveReady: (info: { tracks: Array<{ id: number; codec: string; video?: { width: number; height: number } }> }) => void;
    const readyPromise = new Promise<{ tracks: Array<{ id: number; codec: string; video?: { width: number; height: number } }> }>((resolve) => {
      resolveReady = resolve;
    });

    let resolveSamples: (samples: Array<{ description?: unknown; is_rap?: boolean; cts: number; data: ArrayBuffer }>) => void;
    const samplesPromise = new Promise<Array<{ description?: unknown; is_rap?: boolean; cts: number; data: ArrayBuffer }>>((resolve) => {
      resolveSamples = resolve;
    });

    file.onReady = (info) => resolveReady!(info);
    file.onError = () => resolveSamples!([]);
    file.onSamples = (_id, _user, samples) => resolveSamples!(samples);

    const buf = ab as ArrayBuffer & { fileStart?: number };
    buf.fileStart = 0;
    file.appendBuffer(buf);
    file.flush();

    const info = await readyPromise;
    if (signal?.aborted) return null;

    const videoTrack = info.tracks.find((t) => t.video != null);
    if (!videoTrack) return null;

    file.setExtractionOptions(videoTrack.id, null, { nbSamples: 1 });
    file.start();
    file.flush();

    const samples = await samplesPromise;
    if (signal?.aborted || samples.length === 0) return null;

    const sample = samples[0];
    const codec = videoTrack.codec;
    const width = videoTrack.video?.width ?? 0;
    const height = videoTrack.video?.height ?? 0;
    if (width <= 0 || height <= 0) return null;

    let description: ArrayBuffer | undefined;
    const desc = sample.description as { avcC?: { write: (stream: unknown) => void } } | undefined;
    if (desc?.avcC?.write) {
      const { DataStream } = await import("mp4box");
      const stream = new (DataStream as unknown as new (buf: ArrayBuffer) => { buffer: ArrayBuffer; position: number })(new ArrayBuffer(512));
      desc.avcC.write(stream as never);
      description = stream.buffer.slice(0, stream.position);
    }

    const config: { codec: string; description?: ArrayBuffer; codedWidth: number; codedHeight: number } = {
      codec,
      codedWidth: width,
      codedHeight: height,
    };
    if (description && description.byteLength > 0) config.description = description;

    const supported = await (globalThis as unknown as { VideoDecoder: { isConfigSupported: (c: unknown) => Promise<{ supported: boolean }> } }).VideoDecoder.isConfigSupported(config);
    if (!supported?.supported) return null;

    let resolveFrame: (f: VideoFrame | null) => void;
    let timeoutId: ReturnType<typeof setTimeout>;
    const framePromise = new Promise<VideoFrame | null>((resolve) => {
      resolveFrame = (f) => {
        clearTimeout(timeoutId);
        resolve(f);
      };
      timeoutId = setTimeout(() => resolve(null), 10000);
    });

    const VideoDecoderCtor = (globalThis as unknown as { VideoDecoder: new (init: {
      output: (frame: VideoFrame) => void;
      error: (e: Error) => void;
    }) => VideoDecoder }).VideoDecoder;
    const decoder = new VideoDecoderCtor({
      output: (frame: VideoFrame) => resolveFrame!(frame),
      error: () => resolveFrame!(null),
    });
    decoder.configure(config as VideoDecoderConfig);

    const chunk = new EncodedVideoChunk({
      type: sample.is_rap ? "key" : "delta",
      timestamp: sample.cts,
      duration: 0,
      data: sample.data,
    });
    decoder.decode(chunk);
    await decoder.flush();
    decoder.close();

    const frame = await framePromise;
    if (!frame) return null;

    try {
      const w = frame.displayWidth;
      const h = frame.displayHeight;
      if (w <= 0 || h <= 0) return null;

      const allocSize = "allocationSize" in frame && typeof frame.allocationSize === "function"
        ? frame.allocationSize({})
        : w * h + Math.ceil((w / 2) * (h / 2)) * 2;
      const dest = new ArrayBuffer(allocSize);
      await frame.copyTo(dest);
      frame.close();

      const lumaSize = w * h;
      const luma = new Uint8Array(dest, 0, lumaSize);
      const cropW = w - (w % PATCH_SIZE);
      const cropH = h - (h % PATCH_SIZE);
      if (cropW <= 0 || cropH <= 0) return null;

      const cropped = new Uint8Array(cropW * cropH);
      for (let y = 0; y < cropH; y++) {
        cropped.set(luma.subarray(y * w, y * w + cropW), y * cropW);
      }

      return { luma: cropped, width: cropW, height: cropH };
    } catch {
      frame.close();
      return null;
    }
  } catch {
    return null;
  }
}
