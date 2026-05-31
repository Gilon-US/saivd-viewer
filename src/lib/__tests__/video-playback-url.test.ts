import {resolveWatermarkedStorageKey, videoPlayProxyUrl} from "@/lib/video-playback-url";

describe("video-playback-url", () => {
  it("resolves watermarked key from processed_url", () => {
    expect(
      resolveWatermarkedStorageKey({
        original_url: "users/a/original.mp4",
        processed_url: "users/a/watermarked.mp4",
      }),
    ).toBe("users/a/watermarked.mp4");
  });

  it("falls back to original_url when processed_url is missing", () => {
    expect(
      resolveWatermarkedStorageKey({
        original_url: "users/a/video.mp4",
        processed_url: null,
      }),
    ).toBe("users/a/video.mp4");
  });

  it("builds redirect play proxy URL", () => {
    expect(videoPlayProxyUrl("abc-123")).toBe(
      "/api/videos/abc-123/play?variant=watermarked&redirect=1",
    );
  });
});
