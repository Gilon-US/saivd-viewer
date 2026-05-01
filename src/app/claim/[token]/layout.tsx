import {Metadata} from "next";
import {ReactNode} from "react";

export const metadata: Metadata = {
  title: "Claim video | SAIVD Viewer",
  description: "Claim a video shared with you by a SAIVD creator.",
  robots: {
    index: false,
    follow: false,
    googleBot: {index: false, follow: false},
  },
};

export default function ClaimLayout({children}: {children: ReactNode}) {
  return <div className="min-h-screen bg-gray-50 dark:bg-gray-900">{children}</div>;
}
