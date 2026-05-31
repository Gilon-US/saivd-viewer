export type VerifyMode = "blob" | "shadow" | "img";

export function getVerifyMode(): VerifyMode {
  const raw = process.env.NEXT_PUBLIC_VERIFY_MODE ?? "blob";
  if (raw === "shadow" || raw === "img") return raw;
  return "blob";
}
