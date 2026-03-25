import { renderHook, act } from "@testing-library/react";
import { useFrameAnalysis } from "../useFrameAnalysis";
import { RefObject } from "react";
import { captureVideoFrameImageData } from "@/lib/watermark-verification";

const mockDecodeAndVerifyFrame = jest.fn();
const mockImportPublicKeyFromPem = jest.fn();

jest.mock("@/lib/watermark-verification", () => ({
  captureVideoFrameImageData: jest.fn(),
  importPublicKeyFromPem: (pem: string) => mockImportPublicKeyFromPem(pem),
  decodeAndVerifyFrame: (...args: unknown[]) => mockDecodeAndVerifyFrame(...args),
}));

describe("useFrameAnalysis", () => {
  let mockVideo: Partial<HTMLVideoElement>;
  let videoRef: RefObject<HTMLVideoElement>;
  const PEM = "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkq\n-----END PUBLIC KEY-----";

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

    (captureVideoFrameImageData as unknown as jest.Mock).mockReturnValue({
      data: new Uint8ClampedArray(320 * 240 * 4),
      width: 320,
      height: 240,
    });

    mockImportPublicKeyFromPem.mockResolvedValue({} as CryptoKey);
    mockDecodeAndVerifyFrame.mockResolvedValue({ verified: true });
  });

  it("returns verificationFailed false initially", () => {
    const { result } = renderHook(() =>
      useFrameAnalysis(videoRef, false, undefined, null, null)
    );
    expect(result.current.verificationFailed).toBe(false);
  });

  it("does not start loop when not playing", () => {
    renderHook(() =>
      useFrameAnalysis(videoRef, false, "vid-1", 123, PEM)
    );
    expect(global.requestAnimationFrame).not.toHaveBeenCalled();
  });

  it("does not start loop when publicKeyPem is null", () => {
    renderHook(() =>
      useFrameAnalysis(videoRef, true, "vid-1", 123, null)
    );
    expect(global.requestAnimationFrame).not.toHaveBeenCalled();
  });

  it("starts loop when playing with videoId and publicKeyPem", () => {
    renderHook(() =>
      useFrameAnalysis(videoRef, true, "vid-1", 123, PEM)
    );
    expect(global.requestAnimationFrame).toHaveBeenCalled();
  });

  it("sets verificationFailed when signature verify returns false", async () => {
    mockDecodeAndVerifyFrame.mockResolvedValue({ verified: false });
    const { result } = renderHook(() =>
      useFrameAnalysis(videoRef, true, "vid-1", 123, PEM)
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });
    expect(result.current.verificationFailed).toBe(true);
  });

  it("keeps verificationFailed false when signature verify returns true", async () => {
    mockDecodeAndVerifyFrame.mockResolvedValue({ verified: true });
    const { result } = renderHook(() =>
      useFrameAnalysis(videoRef, true, "vid-1", 123, PEM)
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });
    expect(result.current.verificationFailed).toBe(false);
  });
});
