/**
 * Extract packed row-major Y luma from FFmpeg `rawvideo` + `yuv420p` output.
 *
 * FFmpeg stores planar Y with linesize >= width (typically 32-byte aligned), then U and V.
 * Taking `buf.slice(0, width*height)` is wrong - it reads misaligned rows and bleeds into U/V.
 */

function alignUp(value: number, align: number): number {
  return Math.ceil(value / align) * align;
}

export function extractYLumaFromYuv420pRaw(
  full: Uint8Array,
  width: number,
  height: number
): Uint8Array {
  const total = full.length;
  if (total === 0) {
    throw new Error("yuv420p buffer is empty (ffmpeg produced no output)");
  }

  const chromaRows = Math.ceil(height / 2);

  type Pair = {lsY: number; lsUV: number};
  const tryPairs: Pair[] = [];
  for (const align of [32, 16, 64, 8]) {
    tryPairs.push({
      lsY: alignUp(width, align),
      lsUV: alignUp(Math.ceil(width / 2), align),
    });
  }
  const seen = new Set<string>();
  for (const p of tryPairs) {
    const key = `${p.lsY}:${p.lsUV}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const expected = p.lsY * height + 2 * p.lsUV * chromaRows;
    if (expected === total) {
      return copyYRows(full, width, height, p.lsY);
    }
  }

  for (let lsY = width; lsY <= width + 128; lsY++) {
    for (const align of [32, 16, 8]) {
      const lsUV = alignUp(Math.ceil(width / 2), align);
      const expected = lsY * height + 2 * lsUV * chromaRows;
      if (expected === total) {
        return copyYRows(full, width, height, lsY);
      }
    }
  }

  const ls = (2 * total) / (3 * height);
  if (Number.isInteger(ls) && ls >= width) {
    const expected = (ls * height * 3) / 2;
    if (expected === total) {
      return copyYRows(full, width, height, ls);
    }
  }

  throw new Error(
    `Cannot parse yuv420p raw buffer: len=${total}, w=${width}, h=${height} (expected one of common stride layouts)`
  );
}

function copyYRows(
  full: Uint8Array,
  width: number,
  height: number,
  lsY: number
): Uint8Array {
  const yPlane = new Uint8Array(width * height);
  for (let row = 0; row < height; row++) {
    const src = row * lsY;
    yPlane.set(full.subarray(src, src + width), row * width);
  }
  return yPlane;
}
