import {Metadata} from "next";
import {ReactNode} from "react";

export const metadata: Metadata = {
  title: "Watch | SAIVD Viewer",
  description: "Watch a verified SAIVD video.",
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
    },
  },
};

export default function PublicVideoLayout({children}: {children: ReactNode}) {
  return <div className="min-h-screen bg-black text-white">{children}</div>;
}
