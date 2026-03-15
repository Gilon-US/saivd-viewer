/**
 * WebCodecs-based frame 0 luma extraction for watermark verification.
 * Fetches the video via Range request(s), demuxes with mp4box,
 * decodes the first frame with VideoDecoder, and returns the Y plane (cropped to 16).
 * Supports faststart (moov at start) and non-faststart (moov at end) MP4.
 */

const RANGE_BYTES = 8 * 1024 * 1024; // 8 MB for faststart MP4 or mdat start
const TAIL_BYTES = 5 * 1024 * 1024; // 5 MB for non-faststart moov at end
const MOOV_READY_TIMEOUT_MS = 2500;
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
    console.log("[webcodecs-diagnostic] VideoDecoder not supported; returning null");
    return null;
  }

  try {
    console.log("[webcodecs-diagnostic] Fetching range 0–" + (RANGE_BYTES - 1));
    const res = await fetch(videoUrl, {
      method: "GET",
      headers: { Range: `bytes=0-${RANGE_BYTES - 1}` },
      signal,
    });
    if (!res.ok) {
      console.warn("[webcodecs-diagnostic] Range fetch not ok", { status: res.status, statusText: res.statusText });
      return null;
    }

    const ab = await res.arrayBuffer();
    if (signal?.aborted) return null;
    console.log("[webcodecs-diagnostic] Range received", { bytes: ab.byteLength });

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

    let info: { tracks: Array<{ id: number; codec: string; video?: { width: number; height: number } }> };
    try {
      info = await Promise.race([
        readyPromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("moov_timeout")), MOOV_READY_TIMEOUT_MS)
        ),
      ]);
    } catch (e) {
      if (signal?.aborted) return null;
      if (e instanceof Error && e.message === "moov_timeout") {
        console.log("[webcodecs-diagnostic] Moov not in first range; trying non-faststart (fetch end of file)");
        const headRes = await fetch(videoUrl, { method: "HEAD", signal });
        const contentLength = headRes.headers.get("Content-Length");
        if (!contentLength) {
          console.warn("[webcodecs-diagnostic] No Content-Length for tail fetch");
          return null;
        }
        const total = parseInt(contentLength, 10);
        if (!Number.isFinite(total) || total <= 0) return null;
        const tailStart = Math.max(0, total - TAIL_BYTES);
        const tailRes = await fetch(videoUrl, {
          method: "GET",
          headers: { Range: `bytes=${tailStart}-${total - 1}` },
          signal,
        });
        if (!tailRes.ok) return null;
        const tailAb = await tailRes.arrayBuffer();
        if (signal?.aborted) return null;
        const tailBuf = tailAb as ArrayBuffer & { fileStart?: number };
        tailBuf.fileStart = tailStart;
        file.appendBuffer(tailBuf);
        file.flush();
        info = await readyPromise;
      } else {
        throw e;
      }
    }
    if (signal?.aborted) return null;
    console.log("[webcodecs-diagnostic] MP4 moov ready", { tracks: info.tracks?.length, trackIds: info.tracks?.map((t) => t.id) });

    const videoTrack = info.tracks.find((t) => t.video != null);
    if (!videoTrack) {
      console.warn("[webcodecs-diagnostic] No video track found");
      return null;
    }

    file.setExtractionOptions(videoTrack.id, null, { nbSamples: 1 });
    file.start();
    file.flush();

    const samples = await samplesPromise;
    if (signal?.aborted) return null;
    if (samples.length === 0) {
      console.warn("[webcodecs-diagnostic] No samples extracted (mdat may be beyond range or demux needs more data)");
      return null;
    }
    console.log("[webcodecs-diagnostic] First sample received", { width: videoTrack.video?.width, height: videoTrack.video?.height });

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
    if (!supported?.supported) {
      console.warn("[webcodecs-diagnostic] VideoDecoder.isConfigSupported returned false", { codec });
      return null;
    }

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
    if (!frame) {
      console.warn("[webcodecs-diagnostic] No VideoFrame from decoder (decode error or timeout)");
      return null;
    }

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

      console.log("[webcodecs-diagnostic] Frame 0 luma extracted", { cropW, cropH });
      return { luma: cropped, width: cropW, height: cropH };
    } catch (e) {
      console.warn("[webcodecs-diagnostic] copyTo or crop failed", e);
      frame.close();
      return null;
    }
  } catch (e) {
    console.warn("[webcodecs-diagnostic] getFrame0LumaFromUrl failed", e);
    return null;
  }
}
