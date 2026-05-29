export function isImageTransfer(contentType: string, filename: string): boolean {
  if (contentType.startsWith("image/")) return true;
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return ["png", "jpg", "jpeg", "webp", "gif"].includes(ext);
}

export function isVideoTransfer(contentType: string, filename: string): boolean {
  if (contentType.startsWith("video/")) return true;
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return ["mp4", "mov", "avi", "webm", "mkv"].includes(ext);
}
