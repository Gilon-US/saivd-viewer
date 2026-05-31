import {
  getMoovRangeSteps,
  getVideoElementPlaybackPlan,
  getVideoPerfMaster,
  isVideoPerfOptimized,
  isVerifyFirstLoadEnabled,
  MOOV_RANGE_FASTSTART,
  MOOV_RANGE_LEGACY,
  shouldApplyVerifyFirstLoad,
} from "@/lib/video-perf-flags";

describe("video-perf-flags", () => {
  const env = process.env;

  beforeEach(() => {
    process.env = {...env};
    delete process.env.NEXT_PUBLIC_VIDEO_PERF;
    delete process.env.NEXT_PUBLIC_VIDEO_VERIFY_FIRST;
    delete process.env.NEXT_PUBLIC_VIDEO_MOOV_LADDER;
    delete process.env.NEXT_PUBLIC_VIDEO_LARGE_BYTES;
    delete process.env.NEXT_PUBLIC_VIDEO_UNKNOWN_AS_LARGE;
  });

  afterAll(() => {
    process.env = env;
  });

  it("defaults to legacy master switch", () => {
    expect(getVideoPerfMaster()).toBe("legacy");
    expect(isVideoPerfOptimized()).toBe(false);
    expect(isVerifyFirstLoadEnabled()).toBe(false);
  });

  it("enables sub-flags only when optimized and explicitly set", () => {
    process.env.NEXT_PUBLIC_VIDEO_PERF = "optimized";
    process.env.NEXT_PUBLIC_VIDEO_VERIFY_FIRST = "1";
    expect(isVerifyFirstLoadEnabled()).toBe(true);
    expect(shouldApplyVerifyFirstLoad(null)).toBe(true);
  });

  it("respects large bytes threshold", () => {
    process.env.NEXT_PUBLIC_VIDEO_PERF = "optimized";
    process.env.NEXT_PUBLIC_VIDEO_VERIFY_FIRST = "1";
    process.env.NEXT_PUBLIC_VIDEO_LARGE_BYTES = "1000";
    process.env.NEXT_PUBLIC_VIDEO_UNKNOWN_AS_LARGE = "0";
    expect(shouldApplyVerifyFirstLoad(999)).toBe(false);
    expect(shouldApplyVerifyFirstLoad(1000)).toBe(true);
  });

  it("returns faststart moov ladder when configured", () => {
    process.env.NEXT_PUBLIC_VIDEO_PERF = "optimized";
    process.env.NEXT_PUBLIC_VIDEO_MOOV_LADDER = "faststart";
    expect(getMoovRangeSteps()).toEqual(MOOV_RANGE_FASTSTART);
    delete process.env.NEXT_PUBLIC_VIDEO_MOOV_LADDER;
    expect(getMoovRangeSteps()).toEqual(MOOV_RANGE_LEGACY);
  });

  it("keeps src attached with metadata preload while verifying under verify-first", () => {
    process.env.NEXT_PUBLIC_VIDEO_PERF = "optimized";
    process.env.NEXT_PUBLIC_VIDEO_VERIFY_FIRST = "1";
    const plan = getVideoElementPlaybackPlan({
      videoUrl: "https://example.com/v.mp4",
      context: "public",
      verificationStatus: "verifying",
      playRequested: false,
    });
    expect(plan.src).toBe("https://example.com/v.mp4");
    expect(plan.srcWithheld).toBe(false);
    expect(plan.preload).toBe("metadata");
  });

  it("restores src after verified", () => {
    process.env.NEXT_PUBLIC_VIDEO_PERF = "optimized";
    process.env.NEXT_PUBLIC_VIDEO_VERIFY_FIRST = "1";
    const plan = getVideoElementPlaybackPlan({
      videoUrl: "https://example.com/v.mp4",
      context: "public",
      verificationStatus: "verified",
      playRequested: false,
    });
    expect(plan.src).toBe("https://example.com/v.mp4");
    expect(plan.preload).toBe("auto");
  });
});
