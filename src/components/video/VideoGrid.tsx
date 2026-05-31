"use client";
import {Card, CardContent} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {UploadIcon, RefreshCwIcon, TrashIcon, LinkIcon} from "lucide-react";
import Image from "next/image";
import {useToast} from "@/hooks/useToast";
import {LoadingSpinner} from "@/components/ui/loading-spinner";
import {DeleteConfirmDialog} from "./DeleteConfirmDialog";
import {VideoPlayer} from "./VideoPlayer";
import {videoPlayProxyUrl} from "@/lib/video-playback-url";
import {isPrewarmEnabled} from "@/lib/video-perf-flags";
import {prewarmWasmVerificationSession} from "@/lib/wasm-watermark-verification-client";
import {useState, useCallback} from "react";

export type Video = {
  id: string;
  filename: string;
  // NOTE: original_url stores the stable storage key in the database.
  // GET /api/videos also returns playback_url (presigned watermarked URL for the player).
  original_url: string;
  /** Presigned watermarked playback URL from GET /api/videos (list). */
  playback_url?: string | null;
  original_thumbnail_url: string;
  preview_thumbnail_data: string | null;
  processed_url: string | null;
  processed_thumbnail_url: string | null;
  status: "uploaded" | "processing" | "processed" | "failed";
  upload_date: string;
};

type VideoGridProps = {
  videos: Video[];
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
  onOpenUploadModal: () => void;
};

export function VideoGrid({videos, isLoading, error, onRefresh, onOpenUploadModal}: VideoGridProps) {
  const {toast} = useToast();
  const [deleteDialog, setDeleteDialog] = useState<{
    isOpen: boolean;
    video: Video | null;
    isDeleting: boolean;
  }>({
    isOpen: false,
    video: null,
    isDeleting: false,
  });

  const [videoPlayer, setVideoPlayer] = useState<{
    isOpen: boolean;
    videoUrl: string | null;
    videoId: string | null;
    enableFrameAnalysis: boolean;
    verificationStatus: "verifying" | "verified" | "failed" | null;
    verifiedUserId: string | null;
  }>({
    isOpen: false,
    videoUrl: null,
    videoId: null,
    enableFrameAnalysis: false,
    verificationStatus: null,
    verifiedUserId: null,
  });

  const handleVerificationComplete = useCallback((status: "verified" | "failed", userId: string | null) => {
    setVideoPlayer((prev) => ({
      ...prev,
      verificationStatus: status,
      verifiedUserId: userId,
    }));
  }, []);

  const handleVideoClick = (video: Video) => {
    const playbackUrl = video.playback_url?.trim() || videoPlayProxyUrl(video.id);

    setVideoPlayer({
      isOpen: true,
      videoUrl: playbackUrl,
      videoId: video.id,
      enableFrameAnalysis: true,
      verificationStatus: "verifying",
      verifiedUserId: null,
    });
  };

  const handleVideoHover = useCallback((video: Video) => {
    if (!isPrewarmEnabled()) return;
    const url = video.playback_url?.trim();
    if (!url) return;
    void prewarmWasmVerificationSession(url);
  }, []);

  const handleClosePlayer = () => {
    setVideoPlayer({
      isOpen: false,
      videoUrl: null,
      videoId: null,
      enableFrameAnalysis: false,
      verificationStatus: null,
      verifiedUserId: null,
    });
  };

  const handleCopyLink = useCallback(
    async (video: Video) => {
      const origin =
        typeof window !== "undefined" && window.location?.origin ? window.location.origin : "";
      const copyUrl = `${origin}/v/${video.id}`;

      try {
        if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(copyUrl);
        } else {
          // Fallback for older browsers / non-secure contexts (HTTP).
          const textarea = document.createElement("textarea");
          textarea.value = copyUrl;
          textarea.setAttribute("readonly", "");
          textarea.style.position = "absolute";
          textarea.style.left = "-9999px";
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand("copy");
          document.body.removeChild(textarea);
        }

        toast({
          title: "Link copied",
          description: copyUrl,
          variant: "success",
        });
      } catch (err) {
        console.error("Failed to copy public link:", err);
        toast({
          title: "Couldn't copy link",
          description:
            err instanceof Error
              ? err.message
              : "Your browser blocked copying. Long-press the video to share manually.",
          variant: "error",
        });
      }
    },
    [toast]
  );

  const handleCopyEmbed = useCallback(
    async (videoId: string) => {
      const origin =
        typeof window !== "undefined" && window.location?.origin ? window.location.origin : "";
      const embedUrl = `${origin}/embed/${videoId}`;
      // Universal embed snippet — works in Hostinger, Wix, WordPress (Custom HTML),
      // Squarespace, Webflow, Ghost, raw HTML. The wrapper <div> with width:100%
      // forces builder products to honor the parent container's width on mobile;
      // some builders' mobile themes interpret bare iframe width/height attributes
      // as fixed pixels, fighting the responsive CSS. Wrapping in a div sidesteps
      // that. The iframe uses aspect-ratio:16/9 (modern, supported in all browsers
      // since late 2021) so it maintains ratio at any width without needing
      // explicit height bookkeeping.
      const snippet =
        `<div style="width:100%;max-width:100%;margin:0 auto;">\n` +
        `  <iframe src="${embedUrl}"\n` +
        `          style="width:100%;aspect-ratio:16/9;border:0;display:block;"\n` +
        `          allow="autoplay; fullscreen; picture-in-picture"\n` +
        `          allowfullscreen loading="lazy"\n` +
        `          referrerpolicy="strict-origin-when-cross-origin"\n` +
        `          title="SAIVD verified video"></iframe>\n` +
        `</div>`;

      try {
        if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(snippet);
        } else {
          const ta = document.createElement("textarea");
          ta.value = snippet;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
        }
        toast({
          title: "Embed code copied",
          description: "Paste it into your site's HTML.",
          variant: "success",
        });
      } catch (err) {
        console.error("Failed to copy embed code:", err);
        toast({
          title: "Couldn't copy embed code",
          description:
            err instanceof Error
              ? err.message
              : "Your browser blocked copying. Try selecting and copying manually.",
          variant: "error",
        });
      }
    },
    [toast]
  );

  const handleDeleteClick = (video: Video) => {
    setDeleteDialog({
      isOpen: true,
      video,
      isDeleting: false,
    });
  };

  const handleDeleteCancel = () => {
    setDeleteDialog({
      isOpen: false,
      video: null,
      isDeleting: false,
    });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteDialog.video) return;

    setDeleteDialog((prev) => ({...prev, isDeleting: true}));

    try {
      const response = await fetch(`/api/videos/${deleteDialog.video.id}`, {
        method: "DELETE",
      });

      const data = await response.json();

      if (data.success) {
        toast({
          title: "Video deleted",
          description: `"${deleteDialog.video.filename}" has been deleted successfully.`,
        });

        // Close dialog and refresh the grid
        setDeleteDialog({
          isOpen: false,
          video: null,
          isDeleting: false,
        });

        onRefresh();
      } else {
        throw new Error(data.error?.message || "Failed to delete video");
      }
    } catch (error) {
      console.error("Error deleting video:", error);
      toast({
        title: "Delete failed",
        description: error instanceof Error ? error.message : "Failed to delete video. Please try again.",
        variant: "error",
      });

      setDeleteDialog((prev) => ({...prev, isDeleting: false}));
    }
  };

  // Empty state when no videos are available
  if (!isLoading && videos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center bg-white dark:bg-gray-800 rounded-lg shadow">
        <div className="mb-4 p-4 bg-gray-100 dark:bg-gray-700 rounded-full">
          <UploadIcon className="h-8 w-8 text-gray-400" />
        </div>
        <h2 className="text-xl font-semibold mb-2">No videos yet</h2>
        <p className="text-gray-500 dark:text-gray-400 mb-6 max-w-md">
          Upload your first video to get started. You can upload MP4, MOV, AVI, or WEBM files up to 500MB.
        </p>
        <Button onClick={onOpenUploadModal}>
          <UploadIcon className="mr-2 h-4 w-4" />
          Upload your first video
        </Button>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center p-8">
        <LoadingSpinner size="lg" />
        <p className="mt-4 text-gray-500 dark:text-gray-400">Loading videos...</p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center bg-white dark:bg-gray-800 rounded-lg shadow">
        <h2 className="text-xl font-semibold text-red-500 mb-2">Error loading videos</h2>
        <p className="text-gray-500 dark:text-gray-400 mb-6">{error}</p>
        <Button onClick={onRefresh} variant="outline">
          <RefreshCwIcon className="mr-2 h-4 w-4" />
          Try again
        </Button>
      </div>
    );
  }

  // Video grid - responsive flex layout
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-6 justify-start">
        {videos.map((video) => (
          <Card key={video.id} className="overflow-hidden flex-shrink-0 w-fit min-w-0">
            <CardContent className="p-4">
              <div className="mb-3 flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-lg truncate max-w-[240px]" title={video.filename}>
                    {video.filename}
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Uploaded {new Date(video.upload_date).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                        title={`Share "${video.filename}"`}
                        aria-label="Share video">
                        <LinkIcon className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => void handleCopyLink(video)}>
                        Copy share link
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => void handleCopyEmbed(video.id)}>
                        Copy embed code
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                    onClick={() => handleDeleteClick(video)}
                    title={`Delete "${video.filename}"`}>
                    <TrashIcon className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Video thumbnail */}
              <div
                className="w-60 max-w-[240px] aspect-video relative bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden cursor-pointer hover:opacity-90 transition-opacity"
                onClick={() => handleVideoClick(video)}
                onMouseEnter={() => handleVideoHover(video)}>
                {video.preview_thumbnail_data ? (
                  // Using <img> for base64 data URLs is appropriate since Next.js Image component
                  // is designed for external URLs and file paths, not data URLs
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={video.preview_thumbnail_data}
                    alt={`${video.filename} - Preview`}
                    className="object-contain w-full h-full"
                  />
                ) : video.original_thumbnail_url &&
                  !video.original_thumbnail_url.includes("placeholder-video-thumbnail") ? (
                  <Image
                    src={video.original_thumbnail_url}
                    alt={`${video.filename} - Thumbnail`}
                    className="object-contain"
                    fill
                    sizes="240px"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gray-200 dark:bg-gray-700">
                    <span className="text-gray-400 text-xs">No preview</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Delete confirmation dialog */}
      <DeleteConfirmDialog
        isOpen={deleteDialog.isOpen}
        onClose={handleDeleteCancel}
        onConfirm={handleDeleteConfirm}
        videoFilename={deleteDialog.video?.filename || ""}
        isDeleting={deleteDialog.isDeleting}
      />

      {/* Video player */}
      {videoPlayer.videoUrl && (
        <VideoPlayer
          videoUrl={videoPlayer.videoUrl}
          videoId={videoPlayer.videoId}
          onClose={handleClosePlayer}
          isOpen={videoPlayer.isOpen}
          enableFrameAnalysis={videoPlayer.enableFrameAnalysis}
          verificationStatus={videoPlayer.verificationStatus}
          verifiedUserId={videoPlayer.verifiedUserId}
          onVerificationComplete={handleVerificationComplete}
          playbackContext="dashboard"
        />
      )}
    </div>
  );
}
