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
  decodeNumericUserIdFromLuma,
  decodeAndVerifyFrameFromLuma,
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
    it("returns null when fewer than 9 values (repsUsed would be 0)", () => {
      expect(decodeNumericUserIdFromRightSide([1, 2, 3])).toBeNull();
    });
    it("decodes 9-digit string from 9 groups of 1 (repsUsed=1)", () => {
      const nineOnes = Array(9).fill(1);
      expect(decodeNumericUserIdFromRightSide(nineOnes)).toBe(111111111);
    });
    it("decodes fixed 9 digits without stripping trailing zeros", () => {
      const rightSide = Array(9).fill(0);
      rightSide[8] = 1;
      expect(decodeNumericUserIdFromRightSide(rightSide)).toBe(1);
    });
    it("returns null when digit out of range", () => {
      expect(decodeNumericUserIdFromRightSide(Array(9).fill(10))).toBeNull();
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

  describe("decodeNumericUserIdFromLuma", () => {
    it("returns null for zero width", () => {
      expect(decodeNumericUserIdFromLuma(new Uint8Array(0), 0, 16)).toBeNull();
    });
    it("returns null for zero height", () => {
      expect(decodeNumericUserIdFromLuma(new Uint8Array(256), 16, 0)).toBeNull();
    });
    it("returns null when width is not multiple of 16", () => {
      const luma = new Uint8Array(20 * 16);
      expect(decodeNumericUserIdFromLuma(luma, 20, 16)).toBeNull();
    });
    it("returns null when height is not multiple of 16", () => {
      const luma = new Uint8Array(16 * 20);
      expect(decodeNumericUserIdFromLuma(luma, 16, 20)).toBeNull();
    });
    it("returns null when luma is shorter than width*height", () => {
      expect(decodeNumericUserIdFromLuma(new Uint8Array(10), 16, 16)).toBeNull();
    });
    it("returns null when frame too small (rightEndIndex <= 0)", () => {
      const luma = new Uint8Array(16 * 16);
      expect(decodeNumericUserIdFromLuma(luma, 16, 16)).toBeNull();
    });
    it("returns numeric user id for synthetic luma that yields 9 zero digits", () => {
      const width = 176;
      const height = 144;
      const luma = new Uint8Array(width * height);
      for (let i = 0; i < luma.length; i++) luma[i] = 0;
      const result = decodeNumericUserIdFromLuma(luma, width, height);
      expect(result).toBe(0);
    });
  });

  describe("decodeAndVerifyFrameFromLuma", () => {
    const mockKey = {} as CryptoKey;
    const verifyMock = jest.fn().mockResolvedValue(false);
    let origSubtle: typeof globalThis.crypto.subtle | undefined;

    beforeAll(() => {
      if (globalThis.crypto?.subtle) {
        origSubtle = globalThis.crypto.subtle;
        (globalThis.crypto as { subtle: { verify: jest.Mock } }).subtle = { verify: verifyMock };
      } else {
        (globalThis as { crypto: { subtle: { verify: jest.Mock } } }).crypto = { subtle: { verify: verifyMock } };
      }
    });
    afterAll(() => {
      if (origSubtle) {
        (globalThis.crypto as { subtle: typeof origSubtle }).subtle = origSubtle;
      }
    });

    it("returns verified false and numericUserId null for zero width", async () => {
      const result = await decodeAndVerifyFrameFromLuma(mockKey, new Uint8Array(0), 0, 16);
      expect(result).toEqual({ verified: false, numericUserId: null });
    });
    it("returns verified false and numericUserId null for invalid dimensions", async () => {
      const result = await decodeAndVerifyFrameFromLuma(mockKey, new Uint8Array(100), 10, 10);
      expect(result.verified).toBe(false);
      expect(result.numericUserId).toBeNull();
    });
    it("returns numericUserId from valid luma and runs verify", async () => {
      const mockCrypto = { subtle: { verify: verifyMock } };
      Object.defineProperty(globalThis, "crypto", { value: mockCrypto, writable: true, configurable: true });
      try {
        const width = 176;
        const height = 144;
        const luma = new Uint8Array(width * height);
        const result = await decodeAndVerifyFrameFromLuma(mockKey, luma, width, height);
        expect(result.numericUserId).toBe(0);
        expect(typeof result.verified).toBe("boolean");
        expect(verifyMock).toHaveBeenCalled();
      } finally {
        delete (globalThis as { crypto?: unknown }).crypto;
      }
    });
  });
});
