import {Metadata} from "next";
import {ReactNode} from "react";

export const metadata: Metadata = {
  title: "Embed | SAIVD Viewer",
  description: "Embedded SAIVD verified video player.",
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
    },
  },
};

export default function EmbedVideoLayout({children}: {children: ReactNode}) {
  return <div className="h-full min-h-screen bg-black text-white">{children}</div>;
}
