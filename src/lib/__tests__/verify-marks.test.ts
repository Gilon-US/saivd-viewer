import {mark, flushBeacon, resetVerifyMarksForTests} from "@/lib/perf/verify-marks";

describe("verify-marks", () => {
  beforeEach(() => {
    resetVerifyMarksForTests();
    process.env.NEXT_PUBLIC_VERIFY_TELEMETRY_SAMPLE = "0";
  });

  it("records marks without throwing", () => {
    expect(() => {
      mark("img-1", "fetch_start");
      mark("img-1", "fetch_end");
    }).not.toThrow();
  });

  it("flushBeacon is a no-op when sampling is 0", () => {
    mark("img-2", "verify_end");
    expect(() => flushBeacon("img-2", {path: "blob", outcome: "ok"})).not.toThrow();
  });
});
