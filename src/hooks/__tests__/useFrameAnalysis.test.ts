import { renderHook, act } from "@testing-library/react";
import { useFrameAnalysis } from "../useFrameAnalysis";
import { RefObject } from "react";

jest.mock("@/lib/watermark-decode", () => ({
  captureFrameToImageData: jest.fn(),
  decodeNumericUserIdFromFrame0: jest.fn(),
  importPublicKeyFromPem: jest.fn(),
  decodeAndVerifyFrame: jest.fn(),
}));

const { captureFrameToImageData, decodeNumericUserIdFromFrame0 } =
  require("@/lib/watermark-decode") as {
    captureFrameToImageData: jest.Mock;
    decodeNumericUserIdFromFrame0: jest.Mock;
  };

describe("useFrameAnalysis", () => {
  let mockVideo: Partial<HTMLVideoElement>;
  let videoRef: RefObject<HTMLVideoElement>;

  beforeEach(() => {
    mockVideo = {
      paused: false,
      ended: false,
      currentTime: 0,
      videoWidth: 320,
      videoHeight: 240,
    };
    videoRef = { current: mockVideo as HTMLVideoElement };

    global.requestAnimationFrame = jest.fn((cb: FrameRequestCallback) => {
      setTimeout(cb, 16);
      return 1;
    });
    global.cancelAnimationFrame = jest.fn();

    (captureFrameToImageData as jest.Mock).mockReturnValue({
      data: new Uint8ClampedArray(320 * 240 * 4),
      width: 320,
      height: 240,
    });
    (decodeNumericUserIdFromFrame0 as jest.Mock).mockReturnValue(123);
  });

  it("returns verificationFailed false initially", () => {
    const { result } = renderHook(() =>
      useFrameAnalysis(videoRef, false, undefined, null, null)
    );
    expect(result.current.verificationFailed).toBe(false);
  });

  it("does not start loop when not playing", () => {
    renderHook(() =>
      useFrameAnalysis(videoRef, false, "vid-1", 123, null)
    );
    expect(global.requestAnimationFrame).not.toHaveBeenCalled();
  });

  it("does not start loop when initialNumericUserId is null", () => {
    renderHook(() =>
      useFrameAnalysis(videoRef, true, "vid-1", null, null)
    );
    expect(global.requestAnimationFrame).not.toHaveBeenCalled();
  });

  it("starts loop when playing with videoId and initialNumericUserId", () => {
    renderHook(() =>
      useFrameAnalysis(videoRef, true, "vid-1", 123, null)
    );
    expect(global.requestAnimationFrame).toHaveBeenCalled();
  });

  it("never sets verificationFailed for decode null (only mismatch fails)", async () => {
    (decodeNumericUserIdFromFrame0 as jest.Mock).mockReturnValue(null);
    const { result } = renderHook(() =>
      useFrameAnalysis(videoRef, true, "vid-1", 123, null)
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });
    expect(result.current.verificationFailed).toBe(false);
  });

  it("sets verificationFailed when decode does not match initialNumericUserId", async () => {
    (decodeNumericUserIdFromFrame0 as jest.Mock).mockReturnValue(456);
    const { result } = renderHook(() =>
      useFrameAnalysis(videoRef, true, "vid-1", 123, null)
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(result.current.verificationFailed).toBe(true);
  });
});
