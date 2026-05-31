/** @jest-environment jsdom */

import {getVerifyMode} from "@/lib/image-verify-mode";
import {verifyImageWatermarkRunner} from "@/lib/image-watermark-verification-runner";
import {decodeBitmapFromBlob, decodeBitmapFromImg} from "@/lib/image-bitmap-decode";
import {verifyImageWatermark} from "@/lib/image-watermark-verification";

jest.mock("@/lib/image-verify-mode", () => ({
  getVerifyMode: jest.fn(() => "blob"),
}));

jest.mock("@/lib/image-bitmap-decode", () => ({
  decodeBitmapFromBlob: jest.fn(async () => ({
    close: jest.fn(),
  })),
  decodeBitmapFromImg: jest.fn(async () => ({
    close: jest.fn(),
  })),
}));

jest.mock("@/lib/image-watermark-verification", () => ({
  verifyImageWatermark: jest.fn(async () => ({ok: true, numericUserId: 42})),
}));

jest.mock("@/lib/perf/verify-marks", () => ({
  mark: jest.fn(),
  flushBeacon: jest.fn(),
}));

const mockedGetVerifyMode = getVerifyMode as jest.MockedFunction<typeof getVerifyMode>;

describe("verifyImageWatermarkRunner", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetVerifyMode.mockReturnValue("blob");
    global.fetch = jest.fn(async () => ({
      ok: true,
      blob: async () => new Blob(["x"], {type: "image/png"}),
    })) as unknown as typeof fetch;
  });

  it("blob mode fetches with provided credentials", async () => {
    const result = await verifyImageWatermarkRunner({
      imageId: "abc",
      img: null,
      viewUrl: "/api/images/abc/view",
      fetchCredentials: "include",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.numericUserId).toBe(42);
    }
    expect(result.path).toBe("blob");
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/images/abc/view",
      expect.objectContaining({credentials: "include"}),
    );
    expect(decodeBitmapFromBlob).toHaveBeenCalled();
  });

  it("img mode uses img decode when verification succeeds", async () => {
    mockedGetVerifyMode.mockReturnValue("img");
    const img = document.createElement("img");

    const result = await verifyImageWatermarkRunner({
      imageId: "abc",
      img,
      viewUrl: "https://example.com/x.png",
      fetchCredentials: "omit",
    });

    expect(decodeBitmapFromImg).toHaveBeenCalledWith(img, "legacy");
    expect(result.path).toBe("img");
    expect(verifyImageWatermark).toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("img mode falls back to blob when img verification fails", async () => {
    mockedGetVerifyMode.mockReturnValue("img");
    (verifyImageWatermark as jest.Mock)
      .mockResolvedValueOnce({ok: false, reason: "invalid_signature"})
      .mockResolvedValueOnce({ok: true, numericUserId: 7});

    const img = document.createElement("img");
    const result = await verifyImageWatermarkRunner({
      imageId: "abc",
      img,
      viewUrl: "https://example.com/x.png",
      fetchCredentials: "omit",
    });

    expect(result.path).toBe("img_then_blob");
    expect(result.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalled();
  });
});
