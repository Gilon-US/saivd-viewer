"use client";

import {useState} from "react";
import {useRouter, usePathname} from "next/navigation";
import {Button} from "@/components/ui/button";
import {VideoGrid} from "@/components/video/VideoGrid";
import {ImageGrid} from "@/components/image/ImageGrid";
import {UploadModal} from "@/components/video/UploadModal";
import {useVideos} from "@/hooks/useVideos";
import {useImages} from "@/hooks/useImages";
import {cn} from "@/lib/utils";
import {UploadIcon, RefreshCwIcon} from "lucide-react";

export type MediaTab = "videos" | "images";

const VIDEOS_PATH = "/dashboard/videos";
const IMAGES_PATH = "/dashboard/images";

function mediaTabFromPathname(pathname: string | null): MediaTab {
  if (pathname === IMAGES_PATH || pathname?.startsWith(`${IMAGES_PATH}/`)) {
    return "images";
  }
  return "videos";
}

type MediaDashboardProps = {
  initialTab?: MediaTab;
};

export function MediaDashboard({initialTab = "videos"}: MediaDashboardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const activeTab = pathname ? mediaTabFromPathname(pathname) : initialTab;
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const {videos, isLoading, error, refresh} = useVideos({autoFetch: true});
  const {images, isLoading: imagesLoading, error: imagesError, refresh: refreshImages, deleteImage} =
    useImages({autoFetch: true});

  const handleRefresh = () => {
    if (activeTab === "videos") refresh();
    else refreshImages();
  };

  const handleUploadComplete = () => {
    if (activeTab === "videos") {
      setTimeout(() => refresh(), 1000);
    }
  };

  const isRefreshing = activeTab === "videos" ? isLoading : imagesLoading;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">My Media</h1>
          <p className="text-gray-500 dark:text-gray-400">
            {activeTab === "videos"
              ? "View and manage your uploaded videos"
              : "View and manage your claimed watermarked images"}
          </p>
        </div>
        <div className="flex space-x-2 shrink-0">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
            <RefreshCwIcon className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setIsUploadModalOpen(true)}>
            <UploadIcon className="h-4 w-4 mr-2" />
            Upload
          </Button>
        </div>
      </div>

      <nav className="flex gap-2 border-b border-gray-200 dark:border-gray-700 pb-3">
        <button
          type="button"
          onClick={() => router.push(VIDEOS_PATH)}
          className={cn(
            "px-3 py-2 rounded-md text-sm font-medium transition-colors",
            activeTab === "videos"
              ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
              : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800",
          )}>
          My Videos
        </button>
        <button
          type="button"
          onClick={() => router.push(IMAGES_PATH)}
          className={cn(
            "px-3 py-2 rounded-md text-sm font-medium transition-colors",
            activeTab === "images"
              ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
              : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800",
          )}>
          My Images
        </button>
      </nav>

      {activeTab === "videos" ? (
        <VideoGrid
          videos={videos}
          isLoading={isLoading}
          error={error}
          onRefresh={refresh}
          onOpenUploadModal={() => setIsUploadModalOpen(true)}
        />
      ) : (
        <ImageGrid
          images={images}
          isLoading={imagesLoading}
          error={imagesError}
          onRefresh={refreshImages}
          onOpenUploadModal={() => setIsUploadModalOpen(true)}
          onDelete={deleteImage}
        />
      )}

      <UploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onUploadComplete={handleUploadComplete}
      />
    </div>
  );
}
