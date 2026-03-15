/**
 * WebCodecs-based frame 0 luma extraction for watermark verification.
 * Fetches the start of the video via Range request, demuxes with mp4box,
 * decodes the first frame with VideoDecoder, and returns the Y plane (cropped to 16).
 * Expects faststart MP4 only (moov atom at beginning).
 */

const RANGE_BYTES = 8 * 1024 * 1024; // 8 MB for faststart MP4 (moov + start of mdat)
const SAMPLES_TIMEOUT_MS = 8000; // max wait for onSamples after start()
const PATCH_SIZE = 16;

/** Fallback H.264 codec strings to try when the container codec (e.g. avc1.4d401f) is rejected by VideoDecoder.isConfigSupported. */
const AVC1_FALLBACK_CODECS = ["avc1.42E01E", "avc1.4d401f", "avc1.4d001f", "avc1.64001f", "avc1.640028"];

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
      seek: (time: number, useRap: boolean) => { offset: number; time: number };
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
    console.log("[webcodecs-diagnostic] MP4 moov ready (faststart)", { tracks: info.tracks?.length, trackIds: info.tracks?.map((t) => t.id) });

    const videoTrack = info.tracks.find((t) => t.video != null);
    if (!videoTrack) {
      console.warn("[webcodecs-diagnostic] No video track found");
      return null;
    }

    const seekResult = file.seek(0, true);
    const firstSampleOffset = seekResult.offset;
    console.log("[webcodecs-diagnostic] seek(0, true) offset", firstSampleOffset);

    file.setExtractionOptions(videoTrack.id, null, { nbSamples: 1 });
    file.start();

    if (firstSampleOffset >= ab.byteLength) {
      console.warn("[webcodecs-diagnostic] First sample offset beyond initial range; fetching sample chunk", {
        offset: firstSampleOffset,
        haveBytes: ab.byteLength,
      });
      const chunkSize = Math.min(2 * 1024 * 1024, RANGE_BYTES);
      const sampleRes = await fetch(videoUrl, {
        method: "GET",
        headers: { Range: `bytes=${firstSampleOffset}-${firstSampleOffset + chunkSize - 1}` },
        signal,
      });
      if (!sampleRes.ok || signal?.aborted) return null;
      const sampleAb = await sampleRes.arrayBuffer();
      if (signal?.aborted) return null;
      const sampleBuf = sampleAb as ArrayBuffer & { fileStart?: number };
      sampleBuf.fileStart = firstSampleOffset;
      file.appendBuffer(sampleBuf);
    } else {
      const chunkLen = Math.min(1024 * 1024, ab.byteLength - firstSampleOffset);
      const chunk = ab.slice(firstSampleOffset, firstSampleOffset + chunkLen);
      const chunkCopy = new ArrayBuffer(chunk.byteLength);
      new Uint8Array(chunkCopy).set(new Uint8Array(chunk));
      (chunkCopy as ArrayBuffer & { fileStart?: number }).fileStart = firstSampleOffset;
      file.appendBuffer(chunkCopy as ArrayBuffer & { fileStart?: number });
    }
    file.flush();

    const samples = await Promise.race([
      samplesPromise,
      new Promise<Array<{ description?: unknown; is_rap?: boolean; cts: number; data: ArrayBuffer }>>((_, reject) =>
        setTimeout(() => reject(new Error("samples_timeout")), SAMPLES_TIMEOUT_MS)
      ),
    ]).catch((e) => {
      if (e instanceof Error && e.message === "samples_timeout") {
        console.warn("[webcodecs-diagnostic] Samples extraction timed out");
        return [];
      }
      throw e;
    });
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

    const baseConfig = {
      codedWidth: width,
      codedHeight: height,
      ...(description && description.byteLength > 0 ? { description } : {}),
    };
    const VideoDecoderAPI = globalThis as unknown as { VideoDecoder: { isConfigSupported: (c: unknown) => Promise<{ supported: boolean }> } };
    const codecsToTry = codec.startsWith("avc1.")
      ? [codec, ...AVC1_FALLBACK_CODECS.filter((c) => c !== codec)]
      : [codec];
    let chosenCodec: string | null = null;
    for (const candidate of codecsToTry) {
      const supported = await VideoDecoderAPI.VideoDecoder.isConfigSupported({
        ...baseConfig,
        codec: candidate,
      });
      if (supported?.supported) {
        chosenCodec = candidate;
        if (candidate !== codec) {
          console.log("[webcodecs-diagnostic] Using fallback codec for VideoDecoder", { from: codec, to: candidate });
        }
        break;
      }
    }
    if (!chosenCodec) {
      console.warn("[webcodecs-diagnostic] VideoDecoder.isConfigSupported returned false for all codecs tried", { codec, tried: codecsToTry });
      return null;
    }
    const config = { ...baseConfig, codec: chosenCodec } as VideoDecoderConfig;

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

    const sampleObj = sample as { is_rap?: boolean; is_sync?: boolean; cts: number; data: ArrayBuffer };
    const isKeyFrame = sampleObj.is_rap ?? sampleObj.is_sync ?? true;
    const chunk = new EncodedVideoChunk({
      type: isKeyFrame ? "key" : "delta",
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
