"use client";

import {createContext, useCallback, useContext, useEffect, useState, ReactNode} from "react";
import {useAuth} from "@/contexts/AuthContext";
import type {AppRole} from "@/lib/app-role";
import type {QrOverlayPosition} from "@/lib/presentation-qr/position";

export interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  qr_overlay_position: QrOverlayPosition;
  role: AppRole;
  created_at: string;
  updated_at: string;
}

interface ProfileContextType {
  profile: Profile | null;
  loading: boolean;
  error: string | null;
  initialized: boolean;
  refreshProfile: () => Promise<void>;
  updateProfile: (
    data: Partial<Pick<Profile, "display_name" | "qr_overlay_position">>,
  ) => Promise<void>;
}

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

export function ProfileProvider({children}: {children: ReactNode}) {
  const {user} = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  const refreshProfile = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/profile");
      const json = await res.json();
      if (json.success) setProfile(json.data as Profile);
      else setError(json.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load profile");
    } finally {
      setLoading(false);
      setInitialized(true);
    }
  }, [user]);

  const updateProfile = useCallback(
    async (data: Partial<Pick<Profile, "display_name" | "qr_overlay_position">>) => {
      if (!user) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/profile", {
          method: "PUT",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify(data),
        });
        const json = await res.json();
        if (json.success) setProfile(json.data as Profile);
        else {
          setError(json.error);
          throw new Error(json.error ?? "Update failed");
        }
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  useEffect(() => {
    if (user) void refreshProfile();
    else {
      setProfile(null);
      setInitialized(true);
    }
  }, [user, refreshProfile]);

  return (
    <ProfileContext.Provider
      value={{profile, loading, error, initialized, refreshProfile, updateProfile}}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile must be used within a ProfileProvider");
  return ctx;
}
