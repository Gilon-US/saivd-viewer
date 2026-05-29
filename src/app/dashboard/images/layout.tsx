import {Metadata} from "next";
import {ReactNode} from "react";

export const metadata: Metadata = {
  title: "My Images | SAIVD Viewer",
  description: "View and manage your claimed watermarked images",
};

export default function ImagesLayout({children}: {children: ReactNode}) {
  return <>{children}</>;
}
