"use client";

import {ReactNode} from "react";
import Link from "next/link";
import {LogoutButton} from "@/components/auth/LogoutButton";
import {useAuth} from "@/contexts/AuthContext";
import {useProfile} from "@/contexts/ProfileContext";
import {isStaffProfile} from "@/lib/app-role";

interface DashboardLayoutProps {
  children: ReactNode;
}

export default function DashboardLayout({children}: DashboardLayoutProps) {
  const {user} = useAuth();
  const {profile} = useProfile();
  const isStaff = isStaffProfile(profile, user?.email);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="flex flex-col">
        <header className="bg-white dark:bg-gray-800 shadow">
          <div className="container mx-auto px-4 py-4 flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <Link href="/dashboard" className="text-xl font-bold">
                SAIVD Viewer
              </Link>
              <nav className="hidden md:flex space-x-4">
                <Link
                  href="/dashboard"
                  className="px-3 py-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700">
                  Dashboard
                </Link>
                {isStaff && (
                  <Link
                    href="/dashboard/settings"
                    className="px-3 py-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700">
                    Settings
                  </Link>
                )}
              </nav>
            </div>
            <div className="flex items-center gap-3">
              {user?.email && (
                <div className="flex flex-col items-end">
                  {profile?.display_name && (
                    <span className="text-sm font-medium text-gray-800 dark:text-gray-200 leading-tight">
                      {profile.display_name}
                    </span>
                  )}
                  <span className="text-xs text-gray-500 dark:text-gray-400">{user.email}</span>
                </div>
              )}
              <LogoutButton variant="ghost" size="sm" showIcon={true} />
            </div>
          </div>
        </header>
        <main className="flex-1 p-6">{children}</main>
        <footer className="bg-white dark:bg-gray-800 shadow-inner py-4">
          <div className="container mx-auto px-4 text-center text-sm text-gray-500">
            © {new Date().getFullYear()} SAIVD App. All rights reserved.
          </div>
        </footer>
      </div>
    </div>
  );
}
