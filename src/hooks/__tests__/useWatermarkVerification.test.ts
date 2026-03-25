import {act, renderHook} from "@testing-library/react";
import {useWatermarkVerification} from "../useWatermarkVerification";
import {captureFrame0YFromUrl, prewarmWebCodecsCapture} from "../../lib/webcodecs-capture";
import {
  decodeAndVerifyFrameFromLuma,
  decodeNumericUserIdFromLuma,
  importPublicKeyFromPem,
} from "../../lib/watermark-verification";

jest.mock("../../lib/webcodecs-capture", () => ({
  captureFrame0YFromUrl: jest.fn(),
  prewarmWebCodecsCapture: jest.fn(),
}));

jest.mock("../../lib/watermark-verification", () => ({
  decodeAndVerifyFrameFromLuma: jest.fn(),
  decodeNumericUserIdFromLuma: jest.fn(),
  importPublicKeyFromPem: jest.fn(),
}));

const mockedCaptureFrame0YFromUrl = captureFrame0YFromUrl as jest.MockedFunction<
  typeof captureFrame0YFromUrl
>;
const mockedPrewarmWebCodecsCapture = prewarmWebCodecsCapture as jest.MockedFunction<
  typeof prewarmWebCodecsCapture
>;
const mockedDecodeNumericUserIdFromLuma = decodeNumericUserIdFromLuma as jest.MockedFunction<
  typeof decodeNumericUserIdFromLuma
>;
const mockedImportPublicKeyFromPem = importPublicKeyFromPem as jest.MockedFunction<
  typeof importPublicKeyFromPem
>;
const mockedDecodeAndVerifyFrameFromLuma = decodeAndVerifyFrameFromLuma as jest.MockedFunction<
  typeof decodeAndVerifyFrameFromLuma
>;

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
    mockedCaptureFrame0YFromUrl.mockResolvedValue({
      yPlane: new Uint8Array(16),
      width: 4,
      height: 4,
    });
    mockedDecodeNumericUserIdFromLuma.mockReturnValue(123456789);
    mockedImportPublicKeyFromPem.mockResolvedValue({} as CryptoKey);
    mockedDecodeAndVerifyFrameFromLuma.mockResolvedValue({
      verified: false,
      numericUserId: 123456789,
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({success: true, data: {public_key_pem: "pem"}}),
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
    expect(mockedPrewarmWebCodecsCapture).toHaveBeenCalled();
  });

  it("fails when frame0 decode does not produce a numeric user id", async () => {
    mockedDecodeNumericUserIdFromLuma.mockReturnValue(null);
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
});
