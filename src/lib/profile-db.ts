import {DEFAULT_QR_OVERLAY_POSITION} from "@/lib/presentation-qr/position";
import {createClient} from "@/utils/supabase/server";

export const PROFILE_COLUMNS_WITH_QR =
  "id, email, display_name, qr_overlay_position, role, created_at, updated_at";

export const PROFILE_COLUMNS_LEGACY = "id, email, display_name, role, created_at, updated_at";

export type ProfileRow = {
  id: string;
  email: string;
  display_name: string | null;
  qr_overlay_position: string;
  role: string;
  created_at: string;
  updated_at: string;
};

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

function isMissingQrOverlayColumn(error: {message?: string} | null): boolean {
  const message = error?.message ?? "";
  return message.includes("qr_overlay_position") && message.includes("does not exist");
}

export async function fetchProfileForUser(supabase: SupabaseServerClient, userId: string) {
  const withQr = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS_WITH_QR)
    .eq("id", userId)
    .single();

  if (!withQr.error && withQr.data) {
    return {data: withQr.data as ProfileRow, error: null};
  }

  if (!isMissingQrOverlayColumn(withQr.error)) {
    return {data: withQr.data as ProfileRow | null, error: withQr.error};
  }

  const legacy = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS_LEGACY)
    .eq("id", userId)
    .single();

  if (legacy.error || !legacy.data) {
    return {data: null, error: legacy.error ?? withQr.error};
  }

  return {
    data: {
      ...legacy.data,
      qr_overlay_position: DEFAULT_QR_OVERLAY_POSITION,
    } as ProfileRow,
    error: null,
  };
}

export async function updateProfileForUser(
  supabase: SupabaseServerClient,
  userId: string,
  updates: Record<string, unknown>,
) {
  const attempt = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", userId)
    .select(PROFILE_COLUMNS_WITH_QR)
    .single();

  if (!attempt.error && attempt.data) {
    return {data: attempt.data as ProfileRow, error: null, qrColumnMissing: false};
  }

  if (!isMissingQrOverlayColumn(attempt.error) || updates.qr_overlay_position === undefined) {
    return {data: attempt.data as ProfileRow | null, error: attempt.error, qrColumnMissing: false};
  }

  const {qr_overlay_position: _qr, ...legacyUpdates} = updates;
  void _qr;

  if (Object.keys(legacyUpdates).length <= 1) {
    return {
      data: null,
      error: {
        message:
          "QR overlay preference is unavailable until migration 20260529100000_profiles_qr_overlay_position is applied.",
      },
      qrColumnMissing: true,
    };
  }

  const legacyAttempt = await supabase
    .from("profiles")
    .update(legacyUpdates)
    .eq("id", userId)
    .select(PROFILE_COLUMNS_LEGACY)
    .single();

  if (legacyAttempt.error || !legacyAttempt.data) {
    return {data: null, error: legacyAttempt.error ?? attempt.error, qrColumnMissing: true};
  }

  return {
    data: {
      ...legacyAttempt.data,
      qr_overlay_position: DEFAULT_QR_OVERLAY_POSITION,
    } as ProfileRow,
    error: null,
    qrColumnMissing: true,
  };
}
