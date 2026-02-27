/**
 * Unit tests for watermark-decode (client-side decode and verify helpers).
 */

import { TextEncoder } from "util";
if (typeof globalThis.TextEncoder === "undefined") {
  (globalThis as unknown as { TextEncoder: typeof TextEncoder }).TextEncoder = TextEncoder;
}

import {
  mode,
  decodeNumericUserIdFromRightSide,
  getRightEndIndex,
  getRightSideRowSums,
  buildPatchMatrix,
  buildMessageBytes,
  PATCH_SIZE,
  REPS,
  USER_ID_DIGITS,
  MAX_MESSAGE_LENGTH,
} from "../watermark-decode";

describe("watermark-decode", () => {
  describe("mode", () => {
    it("returns null for empty array", () => {
      expect(mode([])).toBeNull();
    });
    it("returns the only element for single-element array", () => {
      expect(mode([5])).toBe(5);
    });
    it("returns the most frequent value", () => {
      expect(mode([1, 2, 2, 2, 3])).toBe(2);
    });
    it("returns one of the modes when tie", () => {
      const m = mode([1, 1, 2, 2]);
      expect([1, 2]).toContain(m);
    });
  });

  describe("decodeNumericUserIdFromRightSide", () => {
    it("returns null for empty array", () => {
      expect(decodeNumericUserIdFromRightSide([])).toBeNull();
    });
    it("returns null when fewer than REPS values", () => {
      expect(decodeNumericUserIdFromRightSide([1, 2, 3])).toBeNull();
    });
    it("decodes single digit from 7 repeated values", () => {
      const seven = Array(7).fill(5);
      expect(decodeNumericUserIdFromRightSide(seven)).toBe(5);
    });
    it("strips trailing zeros (backend rstrip)", () => {
      const digits = [...Array(7).fill(1), ...Array(7).fill(0)]; // 1 then 0
      expect(decodeNumericUserIdFromRightSide(digits)).toBe(1);
    });
    it("returns null when digit out of range", () => {
      const invalid = [...Array(7).fill(10)]; // 10 is not 0-9
      expect(decodeNumericUserIdFromRightSide(invalid)).toBeNull();
    });
  });

  describe("getRightEndIndex", () => {
    it("returns 0 when pixelHeight < 5", () => {
      expect(getRightEndIndex(4, 10)).toBe(0);
    });
    it("returns patchCols - numLeftColumns", () => {
      const h = 100;
      const patchCols = 20;
      const groupsPerColumn = Math.floor(h / 5); // 20
      const numLeftColumns = Math.ceil(256 / groupsPerColumn); // 13
      expect(getRightEndIndex(h, patchCols)).toBe(Math.max(0, patchCols - numLeftColumns));
    });
  });

  describe("getRightSideRowSums", () => {
    it("sums first rightEndIndex columns per row and applies modulo", () => {
      const givenFrame = [
        [1, 2, 3],
        [4, 5, 6],
      ];
      const rightEndIndex = 2;
      const result = getRightSideRowSums(givenFrame, rightEndIndex);
      expect(result).toHaveLength(2);
      expect(result[0]).toBe((1 + 2) % 2);
      expect(result[1]).toBe((4 + 5) % 2);
    });
  });

  describe("buildPatchMatrix", () => {
    it("builds matrix of patch means for 16x16 patches", () => {
      const width = 32;
      const height = 32;
      const luma = new Uint8Array(width * height);
      for (let i = 0; i < luma.length; i++) luma[i] = 100;
      const matrix = buildPatchMatrix(luma, width, height);
      expect(matrix).toHaveLength(2);
      expect(matrix[0]).toHaveLength(2);
      expect(matrix[0][0]).toBe(100);
    });
  });

  describe("buildMessageBytes", () => {
  it("encodes first MAX_MESSAGE_LENGTH values as UTF-8", () => {
    const rightSide = [72, 101, 108, 108, 111];
    const bytes = buildMessageBytes(rightSide);
    expect(bytes.length).toBe(5);
    expect(Array.from(bytes)).toEqual([72, 101, 108, 108, 111]);
  });
    it("caps at MAX_MESSAGE_LENGTH", () => {
      const rightSide = Array(150).fill(65);
      const bytes = buildMessageBytes(rightSide);
      expect(bytes.length).toBe(MAX_MESSAGE_LENGTH);
    });
  });

  describe("constants", () => {
    it("exports expected constants", () => {
      expect(PATCH_SIZE).toBe(16);
      expect(REPS).toBe(7);
      expect(USER_ID_DIGITS).toBe(9);
      expect(MAX_MESSAGE_LENGTH).toBe(100);
    });
  });
});
