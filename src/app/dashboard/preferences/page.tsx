"use client";

import {useEffect, useState} from "react";
import Link from "next/link";
import {useProfile} from "@/contexts/ProfileContext";
import {QrOverlayPositionPicker} from "@/components/presentation/QrOverlayPositionPicker";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Alert, AlertDescription} from "@/components/ui/alert";
import {LoadingSpinner} from "@/components/ui/loading-spinner";
import {
  DEFAULT_QR_OVERLAY_POSITION,
  parseQrOverlayPosition,
  type QrOverlayPosition,
} from "@/lib/presentation-qr/position";

export default function PreferencesPage() {
  const {profile, loading, initialized, updateProfile, error} = useProfile();
  const [displayName, setDisplayName] = useState("");
  const [qrOverlayPosition, setQrOverlayPosition] = useState<QrOverlayPosition>(
    DEFAULT_QR_OVERLAY_POSITION,
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setDisplayName(profile.display_name ?? "");
    setQrOverlayPosition(parseQrOverlayPosition(profile.qr_overlay_position));
  }, [profile]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSuccessMessage(null);

    const trimmed = displayName.trim();
    if (trimmed.length < 2 || trimmed.length > 50) {
      setFormError("Display name must be 2–50 characters");
      return;
    }

    setIsSubmitting(true);
    try {
      await updateProfile({
        display_name: trimmed,
        qr_overlay_position: qrOverlayPosition,
      });
      setSuccessMessage("Preferences saved.");
    } catch {
      setFormError("Failed to save preferences");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!initialized || loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Preferences</h1>
        <p className="mt-1 text-gray-500 dark:text-gray-400">
          Manage how your presentation QR appears on watermarked media.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 rounded-lg border bg-white p-6 shadow dark:bg-gray-800">
        <div className="space-y-2">
          <Label htmlFor="displayName">Display name</Label>
          <Input
            id="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            minLength={2}
            maxLength={50}
            disabled={isSubmitting}
          />
        </div>

        <QrOverlayPositionPicker
          value={qrOverlayPosition}
          onChange={setQrOverlayPosition}
          disabled={isSubmitting}
          idPrefix="viewer-preferences-qr-overlay"
        />

        {formError && (
          <Alert variant="destructive">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        )}

        {error && !formError && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {successMessage && (
          <Alert>
            <AlertDescription>{successMessage}</AlertDescription>
          </Alert>
        )}

        <div className="flex gap-3">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving..." : "Save preferences"}
          </Button>
          <Button type="button" variant="outline" asChild>
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        </div>
      </form>
    </div>
  );
}
