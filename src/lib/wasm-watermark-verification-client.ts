/**
 * Lazy-loaded Web Worker + ffmpeg.wasm for watermark verification (Y plane) only.
 * Sessions are stateful per videoUrl; worker + ffmpeg stay warm across videos in-tab.
 */

import {getMoovRangeSteps} from "@/lib/video-perf-flags";

export type WasmFrameYResult = {
  yPlane: Uint8Array;
  width: number;
  height: number;
};

/** Keep worker/ffmpeg warm between player closes (tab lifetime disposal on beforeunload). */
export const WASM_SESSION_KEEPALIVE_MS = 10 * 60 * 1000;

type InitOk = {
  id: number;
  ok: true;
  type: "init";
  videoTrackId: number;
  nbSamples: number;
  width: number;
  height: number;
};

type LoadFfmpegOk = {
  id: number;
  ok: true;
  type: "loadFfmpeg";
};

type DecodeOk = {
  id: number;
  ok: true;
  type: "decodeFrame";
  yPlane: ArrayBuffer;
  width: number;
  height: number;
};

type DisposeOk = {id: number; ok: true; type: "dispose"};
type ErrMsg = {id: number; ok: false; error: string};
type OkMsg = InitOk | LoadFfmpegOk | DecodeOk | DisposeOk;

let worker: Worker | null = null;
let requestSeq = 0;
const pending = new Map<
  number,
  {resolve: (v: OkMsg) => void; reject: (e: Error) => void}
>();

let activeUrl: string | null = null;
let initMeta: {nbSamples: number; width: number; height: number} | null = null;
let disposeTimer: ReturnType<typeof setTimeout> | null = null;
let ffmpegPrewarmPromise: Promise<void> | null = null;
let beforeUnloadRegistered = false;

let sessionEnsureChain: Promise<void> = Promise.resolve();

function enqueueSessionEnsure<T>(fn: () => Promise<T>): Promise<T> {
  const result = sessionEnsureChain.then(() => fn());
  sessionEnsureChain = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

function nextId(): number {
  return ++requestSeq;
}

function baseUrl(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin.replace(/\/$/, "");
  }
  return "";
}

function attachWorkerHandlers(w: Worker) {
  w.onmessage = (ev: MessageEvent<OkMsg | ErrMsg>) => {
    const data = ev.data;
    const p = pending.get(data.id);
    if (!p) return;
    pending.delete(data.id);
    if ("ok" in data && data.ok === false) {
      p.reject(new Error(data.error));
    } else {
      p.resolve(data as OkMsg);
    }
  };
  w.onerror = (err) => {
    for (const [, pr] of pending) {
      pr.reject(new Error(err.message ?? "Worker error"));
    }
    pending.clear();
  };
}

function createWorker(): Worker {
  const w = new Worker(new URL("./watermark-verify.worker.ts", import.meta.url), {
    type: "module",
  });
  attachWorkerHandlers(w);
  return w;
}

function ensureWorker(): Worker {
  if (!worker) {
    worker = createWorker();
  }
  return worker;
}

function registerBeforeUnloadDispose(): void {
  if (beforeUnloadRegistered || typeof window === "undefined") return;
  beforeUnloadRegistered = true;
  window.addEventListener("beforeunload", () => {
    void disposeWasmVerificationSession();
  });
}

function send<T extends OkMsg>(payload: Record<string, unknown>): Promise<T> {
  const w = ensureWorker();
  registerBeforeUnloadDispose();
  const id = nextId();
  return new Promise((resolve, reject) => {
    pending.set(id, {
      resolve: (msg: OkMsg) => resolve(msg as T),
      reject,
    });
    w.postMessage({...payload, id});
  });
}

async function runEnsureWasmVerificationSessionLocked(
  videoUrl: string
): Promise<{nbSamples: number; width: number; height: number} | null> {
  if (activeUrl === videoUrl && initMeta) {
    return initMeta;
  }

  const applyInitOk = (data: InitOk) => {
    activeUrl = videoUrl;
    initMeta = {
      nbSamples: data.nbSamples,
      width: data.width,
      height: data.height,
    };
    return initMeta;
  };

  try {
    const data = await send<InitOk>({
      type: "init",
      videoUrl,
      baseUrl: baseUrl(),
      moovRangeSteps: getMoovRangeSteps(),
    });
    return applyInitOk(data);
  } catch {
    await disposeWasmVerificationSession();
    const data = await send<InitOk>({
      type: "init",
      videoUrl,
      baseUrl: baseUrl(),
      moovRangeSteps: getMoovRangeSteps(),
    });
    return applyInitOk(data);
  }
}

/** Load ffmpeg.wasm inside the worker (no video demux). Safe to call early on route mount. */
export async function prewarmFfmpegInWorker(): Promise<void> {
  if (ffmpegPrewarmPromise) {
    return ffmpegPrewarmPromise;
  }
  ffmpegPrewarmPromise = enqueueSessionEnsure(async () => {
    await send<LoadFfmpegOk>({
      type: "loadFfmpeg",
      baseUrl: baseUrl(),
    });
  }).catch(() => {
    ffmpegPrewarmPromise = null;
  });
  return ffmpegPrewarmPromise;
}

export async function ensureWasmVerificationSession(
  videoUrl: string
): Promise<{nbSamples: number; width: number; height: number} | null> {
  if (disposeTimer) {
    clearTimeout(disposeTimer);
    disposeTimer = null;
  }
  if (activeUrl === videoUrl && initMeta) {
    return initMeta;
  }
  await prewarmFfmpegInWorker();
  return enqueueSessionEnsure(() => runEnsureWasmVerificationSessionLocked(videoUrl));
}

export async function prewarmWasmVerificationSession(videoUrl: string): Promise<void> {
  try {
    await ensureWasmVerificationSession(videoUrl);
  } catch {
    // ignore warmup failures; normal verification path will handle/report errors
  }
}

export function scheduleDisposeWasmVerificationSession(ttlMs: number): void {
  if (disposeTimer) {
    clearTimeout(disposeTimer);
  }
  disposeTimer = setTimeout(() => {
    disposeTimer = null;
    void disposeWasmVerificationSession();
  }, ttlMs);
}

export async function getFrameYFromWasm(
  videoUrl: string,
  frameIndex: number
): Promise<WasmFrameYResult | null> {
  const meta = await ensureWasmVerificationSession(videoUrl);
  if (!meta || frameIndex < 0 || frameIndex >= meta.nbSamples) {
    return null;
  }
  const data = await send<DecodeOk>({
    type: "decodeFrame",
    frameIndex,
  });
  return {
    yPlane: new Uint8Array(data.yPlane),
    width: data.width,
    height: data.height,
  };
}

export async function disposeWasmVerificationSession(): Promise<void> {
  if (disposeTimer) {
    clearTimeout(disposeTimer);
    disposeTimer = null;
  }
  activeUrl = null;
  initMeta = null;
  ffmpegPrewarmPromise = null;
  const w = worker;
  if (!w) return;
  worker = null;
  const id = nextId();
  try {
    await new Promise<void>((resolve, reject) => {
      pending.set(id, {
        resolve: (msg: OkMsg) => {
          if (msg.type === "dispose") resolve();
        },
        reject,
      });
      w.postMessage({id, type: "dispose"});
    });
  } catch {
    // ignore
  }
  try {
    w.terminate();
  } catch {
    // ignore
  }
  pending.clear();
}
