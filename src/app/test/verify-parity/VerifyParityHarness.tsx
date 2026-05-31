"use client";

import {useEffect, useState} from "react";
import {
  decodeBitmapFromBlob,
  decodeBitmapFromImg,
  type BitmapDecodeVariant,
} from "@/lib/image-bitmap-decode";
import {fingerprintBlueRowSums} from "@/lib/image-watermark-verification";

declare global {
  interface Window {
    __runParityCheck?: (args: {
      blob: Blob;
      variant?: BitmapDecodeVariant;
    }) => Promise<{
      equal: boolean;
      firstDivergentRow: number;
      imgHeight: number;
      blobHeight: number;
    }>;
  }
}

function compareFingerprints(a: Int32Array, b: Int32Array): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return i;
  }
  return a.length === b.length ? -1 : len;
}

async function runParityCheck(blob: Blob, variant: BitmapDecodeVariant = "legacy") {
  const blobBmp = await decodeBitmapFromBlob(blob, variant);
  const blobFp = fingerprintBlueRowSums(blobBmp);
  blobBmp.close();
  if ("error" in blobFp) {
    return {equal: false, firstDivergentRow: -2, imgHeight: 0, blobHeight: 0, error: blobFp.error};
  }

  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("img load failed"));
    img.src = url;
  });

  const imgBmp = await decodeBitmapFromImg(img, variant);
  const imgFp = fingerprintBlueRowSums(imgBmp);
  imgBmp.close();
  URL.revokeObjectURL(url);

  if ("error" in imgFp) {
    return {equal: false, firstDivergentRow: -2, imgHeight: 0, blobHeight: blobFp.length, error: imgFp.error};
  }

  const firstDivergentRow = compareFingerprints(blobFp, imgFp);
  return {
    equal: firstDivergentRow === -1,
    firstDivergentRow,
    imgHeight: imgFp.length,
    blobHeight: blobFp.length,
  };
}

export function VerifyParityHarness() {
  const [result, setResult] = useState<string>("");

  useEffect(() => {
    window.__runParityCheck = (args) => runParityCheck(args.blob, args.variant);
    return () => {
      delete window.__runParityCheck;
    };
  }, []);

  const onFile = async (file: File | null) => {
    if (!file) return;
    const out = await runParityCheck(file, "legacy");
    setResult(JSON.stringify(out, null, 2));
  };

  return (
    <main className="min-h-screen p-8 max-w-xl mx-auto space-y-4">
      <h1 className="text-xl font-semibold">Image verify parity harness</h1>
      <p className="text-sm text-gray-600">
        Dev-only. Compares blob vs &lt;img&gt; row-sum fingerprints (legacy decode). Playwright calls{" "}
        <code>window.__runParityCheck</code>.
      </p>
      <input
        type="file"
        accept="image/png"
        onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
      />
      {result ? (
        <pre className="text-xs bg-gray-100 p-3 rounded overflow-auto">{result}</pre>
      ) : null}
    </main>
  );
}
