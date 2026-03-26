import {act, renderHook} from "@testing-library/react";
import {useWatermarkVerification} from "../useWatermarkVerification";
import {
  getFrameYFromWasm,
  prewarmWasmVerificationSession,
  scheduleDisposeWasmVerificationSession,
} from "../../lib/wasm-watermark-verification-client";
import {
  decodeAndVerifyFrameFromLuma,
  decodeNumericUserIdDiagnosticsFromLuma,
  importPublicKeyFromPem,
} from "../../lib/watermark-verification";

jest.mock("../../lib/wasm-watermark-verification-client", () => ({
  getFrameYFromWasm: jest.fn(),
  prewarmWasmVerificationSession: jest.fn(),
  scheduleDisposeWasmVerificationSession: jest.fn(),
}));

jest.mock("../../lib/watermark-verification", () => ({
  decodeAndVerifyFrameFromLuma: jest.fn(),
  decodeNumericUserIdDiagnosticsFromLuma: jest.fn(),
  importPublicKeyFromPem: jest.fn(),
}));

const mockedGetFrameYFromWasm = getFrameYFromWasm as jest.MockedFunction<typeof getFrameYFromWasm>;
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
});
