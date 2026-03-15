/**
 * Ensures the web-demuxer WASM file is present so frame-0 verification can run.
 * Fail fast in CI/deploy if the asset is missing.
 */
import * as fs from "fs";
import * as path from "path";

describe("watermark-webcodecs WASM asset", () => {
  it("public/wasm/web-demuxer.wasm exists", () => {
    const root = path.resolve(__dirname, "../../..");
    const wasmPath = path.join(root, "public", "wasm", "web-demuxer.wasm");
    expect(fs.existsSync(wasmPath)).toBe(true);
    const stat = fs.statSync(wasmPath);
    expect(stat.size).toBeGreaterThan(0);
  });
});
