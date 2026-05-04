"use client";

import {useEffect, useState, FormEvent} from "react";
import {useRouter, useParams} from "next/navigation";
import {useProfile} from "@/contexts/ProfileContext";
import {useAuth} from "@/contexts/AuthContext";
import {isStaffProfile} from "@/lib/app-role";
import {Button} from "@/components/ui/button";
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {LoadingSpinner} from "@/components/ui/loading-spinner";
import {Alert, AlertDescription} from "@/components/ui/alert";

interface AdminUserDetail {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
}

interface AdminUserFormValues {
  display_name: string;
}

export default function SettingsUserDetailPage() {
  const {user} = useAuth();
  const {profile, loading: profileLoading, initialized} = useProfile();
  const router = useRouter();
  const params = useParams<{id: string}>();
  const id = params.id;

  const [userDetail, setUserDetail] = useState<AdminUserDetail | null>(null);
  const [formValues, setFormValues] = useState<AdminUserFormValues>({display_name: ""});
  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const isStaff = isStaffProfile(profile, user?.email);

  useEffect(() => {
    if (!initialized || profileLoading) return;
    if (!isStaff) {
      router.replace("/dashboard");
    }
  }, [initialized, profileLoading, isStaff, router]);

  useEffect(() => {
    if (!isStaff || !id) return;

    const fetchUser = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch(`/api/admin/users/${id}`);
        const result = await response.json();

        if (!response.ok || !result.success) {
          setError(typeof result.error === "string" ? result.error : "Failed to load user");
          return;
        }

        const data = result.data as AdminUserDetail;
        setUserDetail(data);
        setFormValues({display_name: data.display_name || ""});
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load user";
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    fetchUser();
  }, [id, isStaff]);

  const handleChange =
    (field: keyof typeof formValues) => (e: React.ChangeEvent<HTMLInputElement>) => {
      setFormValues((prev) => ({...prev, [field]: e.target.value}));
    };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!id) return;

    try {
      setSaving(true);
      setError(null);
      setSuccessMessage(null);

      const payload: Record<string, unknown> = {
        display_name: formValues.display_name.trim() || null,
      };

      const response = await fetch(`/api/admin/users/${id}`, {
        method: "PUT",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        setError(typeof result.error === "string" ? result.error : "Failed to update user");
        return;
      }

      const updated = result.data as AdminUserDetail;
      setUserDetail(updated);
      setSuccessMessage("User profile updated successfully.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update user";
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  if (!initialized || profileLoading || loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!isStaff) {
    return (
      <div className="max-w-2xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              You do not have permission to view this page.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!userDetail) {
    return (
      <div className="max-w-2xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>User not found</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              The requested user could not be found.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold mb-1">Edit user</h2>
          <p className="text-gray-600 dark:text-gray-300 text-sm">
            Editable fields only; role changes use the Admins tab (superuser).
          </p>
        </div>
        <Button variant="outline" onClick={() => router.push("/dashboard/settings/users")}>
          Back to users
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div>
              <Label className="text-xs font-semibold uppercase text-gray-500">Email</Label>
              <p className="mt-1 text-sm text-gray-800 dark:text-gray-100">{userDetail.email}</p>
            </div>
            <div>
              <Label className="text-xs font-semibold uppercase text-gray-500">Role</Label>
              <p className="mt-1 text-sm uppercase tracking-wide">{userDetail.role}</p>
            </div>
          </div>

          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {successMessage && (
            <Alert className="mb-4">
              <AlertDescription>{successMessage}</AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="display_name">Display name</Label>
              <Input
                id="display_name"
                value={formValues.display_name}
                onChange={handleChange("display_name")}
                placeholder="Display name"
              />
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push("/dashboard/settings/users")}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving..." : "Save changes"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
