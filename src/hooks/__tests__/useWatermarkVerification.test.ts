import {act, renderHook, waitFor} from "@testing-library/react";
import {KEYFRAME_VERIFY_DEADLINE_MS, useWatermarkVerification} from "../useWatermarkVerification";
import {
  getFrameYFromWasm,
  getFrameYuvFromWasm,
  getWasmVideoTrackInfo,
  prewarmWasmVerificationSession,
  scheduleDisposeWasmVerificationSession,
} from "../../lib/wasm-watermark-verification-client";
import {isV3Reading, readFrameV3, verifyV3Signature, type V3FrameReading} from "../../lib/watermark-v3";
import {
  decodeAndVerifyFrameFromLuma,
  decodeNumericUserIdDiagnosticsFromLuma,
  importPublicKeyFromPem,
} from "../../lib/watermark-verification";

jest.mock("../../lib/wasm-watermark-verification-client", () => ({
  getFrameYFromWasm: jest.fn(),
  getFrameYuvFromWasm: jest.fn(),
  getWasmVideoTrackInfo: jest.fn(),
  prewarmWasmVerificationSession: jest.fn(),
  scheduleDisposeWasmVerificationSession: jest.fn(),
}));

jest.mock("../../lib/watermark-v3", () => ({
  isV3Reading: jest.fn(),
  readFrameV3: jest.fn(),
  verifyV3Signature: jest.fn(),
}));

jest.mock("../../lib/watermark-verification", () => ({
  decodeAndVerifyFrameFromLuma: jest.fn(),
  decodeNumericUserIdDiagnosticsFromLuma: jest.fn(),
  importPublicKeyFromPem: jest.fn(),
}));

const mockedGetFrameYFromWasm = getFrameYFromWasm as jest.MockedFunction<typeof getFrameYFromWasm>;
const mockedGetFrameYuvFromWasm = getFrameYuvFromWasm as jest.MockedFunction<typeof getFrameYuvFromWasm>;
const mockedGetWasmVideoTrackInfo = getWasmVideoTrackInfo as jest.MockedFunction<typeof getWasmVideoTrackInfo>;
const mockedReadFrameV3 = readFrameV3 as jest.MockedFunction<typeof readFrameV3>;
const mockedIsV3Reading = isV3Reading as jest.MockedFunction<typeof isV3Reading>;
const mockedVerifyV3Signature = verifyV3Signature as jest.MockedFunction<typeof verifyV3Signature>;
const mockedPrewarmWasmVerificationSession =
  prewarmWasmVerificationSession as jest.MockedFunction<typeof prewarmWasmVerificationSession>;
const mockedScheduleDisposeWasmVerificationSession =
  scheduleDisposeWasmVerificationSession as jest.MockedFunction<typeof scheduleDisposeWasmVerificationSession>;

const mockedDecodeAndVerifyFrameFromLuma = decodeAndVerifyFrameFromLuma as jest.MockedFunction<
  typeof decodeAndVerifyFrameFromLuma
>;
const mockedDecodeNumericUserIdDiagnosticsFromLuma = decodeNumericUserIdDiagnosticsFromLuma as jest.MockedFunction<
  typeof decodeNumericUserIdDiagnosticsFromLuma
>;
const mockedImportPublicKeyFromPem = importPublicKeyFromPem as jest.MockedFunction<
  typeof importPublicKeyFromPem
>;

/** Test frames carry their sample index in width so mocks can tell keyframes apart. */
function yuvFrame(frameIndex: number) {
  return {y: new Uint8Array(16), u: new Uint8Array(4), v: new Uint8Array(4), width: 1000 + frameIndex, height: 4};
}

function v3Reading(userId: number, signatureByte: number | null): V3FrameReading {
  return {
    layout: {} as V3FrameReading["layout"],
    userId,
    userIdY: userId,
    userIdUv: userId,
    signature: signatureByte === null ? null : new Uint8Array(256).fill(signatureByte),
    codewords: new Uint8Array(288),
  };
}

/** Minimal HTMLVideoElement stand-in with requestVideoFrameCallback. */
function fakeVideo() {
  let frameCallback: ((now: number, meta: {mediaTime: number}) => void) | null = null;
  const video = {
    paused: false,
    ended: false,
    seeking: false,
    readyState: 4,
    currentTime: 0,
    pause: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    requestVideoFrameCallback: jest.fn((cb: (now: number, meta: {mediaTime: number}) => void) => {
      frameCallback = cb;
      return 1;
    }),
    cancelVideoFrameCallback: jest.fn(),
  };
  return {
    video,
    ref: {current: video as unknown as HTMLVideoElement} as React.RefObject<HTMLVideoElement | null>,
    present(mediaTime: number) {
      act(() => frameCallback?.(0, {mediaTime}));
    },
  };
}

async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useWatermarkVerification (viewer)", () => {
  const videoRef = {current: null} as React.RefObject<HTMLVideoElement | null>;
  const origFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetFrameYFromWasm.mockResolvedValue({
      yPlane: new Uint8Array(16),
      width: 4,
      height: 4,
    });
    sessionStorage.clear(); // public-key cache
    // Default: plain frames with no v3 U/V block, so the legacy v2 path runs.
    mockedGetFrameYuvFromWasm.mockImplementation(async (_url, frameIndex) => yuvFrame(frameIndex));
    mockedGetWasmVideoTrackInfo.mockResolvedValue({
      nbSamples: 300,
      width: 4,
      height: 4,
      keyframes: [],
    });
    mockedReadFrameV3.mockReturnValue(null);
    mockedIsV3Reading.mockImplementation((r) => !!r && r.userIdUv !== null);
    mockedVerifyV3Signature.mockResolvedValue(true);
    mockedPrewarmWasmVerificationSession.mockResolvedValue();
    mockedScheduleDisposeWasmVerificationSession.mockImplementation(() => {});
    mockedDecodeNumericUserIdDiagnosticsFromLuma.mockReturnValue({
      numericUserId: 123456789,
      bestScore: 0,
      bestShift: 0,
      repsUsed: 7,
      rightSideLength: 120,
      validDigits: true,
    });
    mockedImportPublicKeyFromPem.mockResolvedValue({} as CryptoKey);
    mockedDecodeAndVerifyFrameFromLuma.mockResolvedValue({
      verified: false,
      numericUserId: 123456789,
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {public_key_pem: "-----BEGIN PUBLIC KEY-----\nTEST\n-----END PUBLIC KEY-----"},
      }),
    }) as jest.Mock;
  });

  afterAll(() => {
    global.fetch = origFetch;
  });

  it("verifies when frame0 decode returns a numeric user id", async () => {
    const onVerificationComplete = jest.fn();
    const {result} = renderHook(() =>
      useWatermarkVerification(videoRef, "https://example.com/video.mp4", {
        enabled: true,
        onVerificationComplete,
      })
    );
    await flushAsync();
    expect(result.current.status).toBe("verified");
    expect(result.current.verifiedUserId).toBe("123456789");
    expect(onVerificationComplete).toHaveBeenCalledWith("verified", "123456789");
    expect(mockedPrewarmWasmVerificationSession).toHaveBeenCalled();
  });

  it("fails when frame0 decode does not produce a numeric user id", async () => {
    mockedDecodeNumericUserIdDiagnosticsFromLuma
      .mockReturnValueOnce({
        numericUserId: 444444444,
        bestScore: 1,
        bestShift: 0,
        repsUsed: 4,
        rightSideLength: 60,
        validDigits: true,
      })
      .mockReturnValueOnce({
        numericUserId: null,
        bestScore: Number.POSITIVE_INFINITY,
        bestShift: 0,
        repsUsed: 0,
        rightSideLength: 0,
        validDigits: false,
      })
      .mockReturnValueOnce({
        numericUserId: null,
        bestScore: Number.POSITIVE_INFINITY,
        bestShift: 0,
        repsUsed: 0,
        rightSideLength: 0,
        validDigits: false,
      });
    const onVerificationComplete = jest.fn();
    const {result} = renderHook(() =>
      useWatermarkVerification(videoRef, "https://example.com/video.mp4", {
        enabled: true,
        onVerificationComplete,
      })
    );
    await flushAsync();
    expect(result.current.status).toBe("failed");
    expect(result.current.verifiedUserId).toBeNull();
    expect(onVerificationComplete).toHaveBeenCalledWith("failed", null);
  });

  describe("watermark format v2 keyframes (user-id consistency only)", () => {
    const diag = (numericUserId: number | null) => ({
      numericUserId,
      bestScore: 0,
      bestShift: 0,
      repsUsed: 7,
      rightSideLength: 120,
      validDigits: numericUserId !== null,
    });

    beforeEach(() => {
      mockedGetWasmVideoTrackInfo.mockResolvedValue({
        nbSamples: 300,
        width: 4,
        height: 4,
        keyframes: [
          {index: 0, time: 0},
          {index: 15, time: 0.5},
          {index: 30, time: 1.0},
        ],
      });
      mockedGetFrameYFromWasm.mockImplementation(async (_url, frameIndex) => ({
        yPlane: new Uint8Array(16),
        width: 1000 + frameIndex,
        height: 4,
      }));
    });

    it("keeps playing when every keyframe carries the bootstrap user id, without v2 RSA", async () => {
      const {ref, video} = fakeVideo();
      const {result} = renderHook(() => useWatermarkVerification(ref, "https://example.com/v2.mp4", {enabled: true}));
      await waitFor(() => expect(mockedGetFrameYFromWasm).toHaveBeenCalledWith("https://example.com/v2.mp4", 30));
      await flushAsync();
      expect(result.current.watermarkFormat).toBe("v2");
      expect(result.current.status).toBe("verified");
      expect(video.pause).not.toHaveBeenCalled();
      // bootstrap still logs the legacy RSA (once); keyframes never call it
      expect(mockedDecodeAndVerifyFrameFromLuma).toHaveBeenCalledTimes(1);
    });

    it("blocks when a keyframe carries a different user id", async () => {
      mockedDecodeNumericUserIdDiagnosticsFromLuma.mockImplementation((_y, width) =>
        diag(width === 1030 ? 987654321 : 123456789)
      );
      const {ref, video} = fakeVideo();
      const {result} = renderHook(() => useWatermarkVerification(ref, "https://example.com/v2.mp4", {enabled: true}));
      await waitFor(() => expect(result.current.status).toBe("failed"));
      expect(video.pause).toHaveBeenCalled();
    });

    it("treats an unreadable user id as an error: one skip, then block", async () => {
      mockedDecodeNumericUserIdDiagnosticsFromLuma.mockImplementation((_y, width) =>
        diag(width === 1015 || width === 1030 ? null : 123456789)
      );
      const {ref} = fakeVideo();
      const {result} = renderHook(() => useWatermarkVerification(ref, "https://example.com/v2.mp4", {enabled: true}));
      await waitFor(() => expect(result.current.status).toBe("failed"));
    });
  });

  describe("watermark format v3", () => {
    const KEYFRAMES = [
      {index: 0, time: 0},
      {index: 15, time: 0.5},
      {index: 30, time: 1.0},
    ];

    beforeEach(() => {
      mockedGetWasmVideoTrackInfo.mockResolvedValue({nbSamples: 300, width: 1000, height: 4, keyframes: KEYFRAMES});
      // Every frame is v3 with user 123456789; the signature byte encodes the sample index.
      mockedReadFrameV3.mockImplementation((frame) => v3Reading(123456789, frame.width - 1000));
    });

    it("detects v3 and starts playback even when the bootstrap signature fails", async () => {
      mockedVerifyV3Signature.mockResolvedValue(false);
      const onVerificationComplete = jest.fn();
      const {result} = renderHook(() =>
        useWatermarkVerification(videoRef, "https://example.com/v3.mp4", {enabled: true, onVerificationComplete})
      );
      await waitFor(() => expect(result.current.status).toBe("verified"));
      expect(result.current.watermarkFormat).toBe("v3");
      expect(result.current.verifiedUserId).toBe("123456789");
      expect(onVerificationComplete).toHaveBeenCalledWith("verified", "123456789");
      expect(mockedGetFrameYuvFromWasm).toHaveBeenCalledWith("https://example.com/v3.mp4", 0);
      expect(mockedDecodeNumericUserIdDiagnosticsFromLuma).not.toHaveBeenCalled();
    });

    it("verifies later keyframes with the frame count as the signed id", async () => {
      const {ref, video} = fakeVideo();
      const {result} = renderHook(() => useWatermarkVerification(ref, "https://example.com/v3.mp4", {enabled: true}));
      await waitFor(() => expect(mockedGetFrameYuvFromWasm).toHaveBeenCalledWith("https://example.com/v3.mp4", 30));
      await flushAsync();
      expect(result.current.status).toBe("verified");
      expect(video.pause).not.toHaveBeenCalled();
      expect(mockedVerifyV3Signature).toHaveBeenCalledWith(expect.anything(), expect.any(Uint8Array), 300, 123456789);
    });

    it("blocks playback when a later keyframe's signature fails", async () => {
      mockedVerifyV3Signature.mockImplementation(async (_k, sig) => sig[0] !== 15);
      const {ref, video} = fakeVideo();
      const onVerificationComplete = jest.fn();
      const {result} = renderHook(() =>
        useWatermarkVerification(ref, "https://example.com/v3.mp4", {enabled: true, onVerificationComplete})
      );
      await waitFor(() => expect(result.current.status).toBe("failed"));
      expect(video.pause).toHaveBeenCalled();
      // The completion callback fires once per video (existing behavior): "verified" at bootstrap.
      expect(onVerificationComplete).toHaveBeenCalledTimes(1);
      // the public key is refreshed once (cache cleared, refetched with bypassCache) before blocking
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it("blocks playback when a keyframe's signature is unreadable (RS uncorrectable)", async () => {
      mockedReadFrameV3.mockImplementation((frame) =>
        v3Reading(123456789, frame.width === 1015 ? null : frame.width - 1000)
      );
      const {ref} = fakeVideo();
      const {result} = renderHook(() => useWatermarkVerification(ref, "https://example.com/v3.mp4", {enabled: true}));
      await waitFor(() => expect(result.current.status).toBe("failed"));
    });

    it("blocks playback when a keyframe carries a different user id", async () => {
      mockedReadFrameV3.mockImplementation((frame) =>
        v3Reading(frame.width === 1030 ? 987654321 : 123456789, frame.width - 1000)
      );
      const {ref} = fakeVideo();
      const {result} = renderHook(() => useWatermarkVerification(ref, "https://example.com/v3.mp4", {enabled: true}));
      await waitFor(() => expect(result.current.status).toBe("failed"));
    });

    it("uses the one-skip allowance for a decode error, then keeps verifying", async () => {
      mockedGetFrameYuvFromWasm.mockImplementation(async (_url, frameIndex) => {
        if (frameIndex === 15) throw new Error("range fetch failed");
        return yuvFrame(frameIndex);
      });
      const {ref, video} = fakeVideo();
      const {result} = renderHook(() => useWatermarkVerification(ref, "https://example.com/v3.mp4", {enabled: true}));
      await waitFor(() => expect(mockedGetFrameYuvFromWasm).toHaveBeenCalledWith("https://example.com/v3.mp4", 30));
      await flushAsync();
      expect(result.current.status).toBe("verified");
      expect(video.pause).not.toHaveBeenCalled();
    });

    it("blocks on a second decode error in a row", async () => {
      mockedGetFrameYuvFromWasm.mockImplementation(async (_url, frameIndex) => {
        if (frameIndex === 15 || frameIndex === 30) throw new Error("range fetch failed");
        return yuvFrame(frameIndex);
      });
      const {ref} = fakeVideo();
      const {result} = renderHook(() => useWatermarkVerification(ref, "https://example.com/v3.mp4", {enabled: true}));
      await waitFor(() => expect(result.current.status).toBe("failed"));
    });

    it("blocks when a reached keyframe stays unverified past the deadline", async () => {
      jest.useFakeTimers();
      try {
        mockedGetFrameYuvFromWasm.mockImplementation((_url, frameIndex) =>
          frameIndex === 15 ? new Promise(() => {}) : Promise.resolve(yuvFrame(frameIndex))
        );
        const {ref, present} = fakeVideo();
        const {result} = renderHook(() => useWatermarkVerification(ref, "https://example.com/v3.mp4", {enabled: true}));
        for (let i = 0; i < 20 && result.current.status !== "verified"; i++) await flushAsync();
        expect(result.current.status).toBe("verified");
        await flushAsync();
        present(0.6); // playhead passed keyframe 15 (t = 0.5 s), still unverified

        await act(async () => {
          jest.advanceTimersByTime(KEYFRAME_VERIFY_DEADLINE_MS - 1000);
        });
        expect(result.current.status).toBe("verified");
        await act(async () => {
          jest.advanceTimersByTime(1500);
        });
        expect(result.current.status).toBe("failed");
      } finally {
        jest.useRealTimers();
      }
    });

    it("does not count paused time toward the deadline", async () => {
      jest.useFakeTimers();
      try {
        mockedGetFrameYuvFromWasm.mockImplementation((_url, frameIndex) =>
          frameIndex === 15 ? new Promise(() => {}) : Promise.resolve(yuvFrame(frameIndex))
        );
        const {ref, present, video} = fakeVideo();
        const {result} = renderHook(() => useWatermarkVerification(ref, "https://example.com/v3.mp4", {enabled: true}));
        for (let i = 0; i < 20 && result.current.status !== "verified"; i++) await flushAsync();
        await flushAsync();
        present(0.6);
        video.paused = true;
        await act(async () => {
          jest.advanceTimersByTime(KEYFRAME_VERIFY_DEADLINE_MS * 3);
        });
        expect(result.current.status).toBe("verified");
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
