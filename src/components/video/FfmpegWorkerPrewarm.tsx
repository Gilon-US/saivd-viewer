"use client";

import {useEffect} from "react";
import {isPrewarmEnabled} from "@/lib/video-perf-flags";
import {prewarmFfmpegInWorker} from "@/lib/wasm-watermark-verification-client";

/** Spawn verification worker and load ffmpeg.wasm before a video is opened. */
export function FfmpegWorkerPrewarm() {
  useEffect(() => {
    if (!isPrewarmEnabled()) return;
    void prewarmFfmpegInWorker();
  }, []);
  return null;
}
