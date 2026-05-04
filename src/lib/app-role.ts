import {isBootstrapSuperuserEmail} from "@/lib/bootstrap-superuser";

export type AppRole = "user" | "admin" | "superuser";

export function isStaffRole(role: string | null | undefined): boolean {
  return role === "admin" || role === "superuser";
}

export function isStaffProfile(
  profile: {role?: string | null; email?: string | null} | null | undefined,
  authEmail?: string | null
): boolean {
  if (isBootstrapSuperuserEmail(authEmail)) return true;
  if (!profile) return false;
  if (isBootstrapSuperuserEmail(profile.email)) return true;
  return isStaffRole(profile.role);
}

export function isSuperuserProfile(
  profile: {role?: string | null; email?: string | null} | null | undefined,
  authEmail?: string | null
): boolean {
  if (isBootstrapSuperuserEmail(authEmail)) return true;
  if (!profile) return false;
  if (isBootstrapSuperuserEmail(profile.email)) return true;
  return profile.role === "superuser";
}

export function effectiveProfileRole(
  profile: {role?: string | null; email?: string | null} | null | undefined,
  authEmail?: string | null
): AppRole {
  if (isBootstrapSuperuserEmail(authEmail)) return "superuser";
  if (!profile) return "user";
  if (isBootstrapSuperuserEmail(profile.email)) return "superuser";
  const r = profile.role;
  if (r === "admin" || r === "superuser" || r === "user") return r;
  return "user";
}
