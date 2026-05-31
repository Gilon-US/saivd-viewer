export type BitmapDecodeVariant = "legacy" | "strict";

/** Options aligned with spec-oriented decode (EXIF, no color management). */
export function strictCreateImageBitmapOptions(): ImageBitmapOptions {
  return {
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
    imageOrientation: "from-image",
  };
}

export async function decodeBitmapFromBlob(
  blob: Blob,
  variant: BitmapDecodeVariant = "legacy",
): Promise<ImageBitmap> {
  if (variant === "legacy") {
    return createImageBitmap(blob);
  }
  return createImageBitmap(blob, strictCreateImageBitmapOptions());
}

export async function decodeBitmapFromImg(
  img: HTMLImageElement,
  variant: BitmapDecodeVariant = "legacy",
): Promise<ImageBitmap> {
  if (typeof img.decode === "function") {
    await img.decode();
  }
  if (variant === "legacy") {
    return createImageBitmap(img);
  }
  return createImageBitmap(img, strictCreateImageBitmapOptions());
}
