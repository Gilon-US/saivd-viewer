import type {ReactNode} from "react";

type PublicImageShellProps = {
  viewUrl: string;
  imageId: string;
  embed?: boolean;
  children: ReactNode;
};

/** Server-rendered image shell so the browser starts downloading before client hydration. */
export function PublicImageShell({viewUrl, imageId, embed = false, children}: PublicImageShellProps) {
  return (
    <div
      className={`relative flex items-center justify-center bg-gray-100 dark:bg-gray-900 ${embed ? "h-full w-full" : "min-h-screen p-4"}`}>
      <div className="relative inline-block max-w-full max-h-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          data-saivd-public-image={imageId}
          src={viewUrl}
          alt="Verified image"
          crossOrigin="anonymous"
          fetchPriority="high"
          decoding="async"
          className="block max-w-full max-h-full object-contain rounded-lg shadow-2xl"
        />
        {children}
      </div>
    </div>
  );
}
