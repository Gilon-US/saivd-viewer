"use client";

import {Card, CardContent} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {RefreshCwIcon, TrashIcon, LinkIcon, ImageIcon} from "lucide-react";
import {useToast} from "@/hooks/useToast";
import {LoadingSpinner} from "@/components/ui/loading-spinner";
import {DeleteConfirmDialog} from "@/components/video/DeleteConfirmDialog";
import {ImageLightbox} from "./ImageLightbox";
import {useState, useCallback} from "react";
import type {ImageRecord} from "@/hooks/useImages";

type ImageGridProps = {
  images: ImageRecord[];
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
  onOpenUploadModal: () => void;
  onDelete: (id: string) => Promise<void>;
};

export function ImageGrid({
  images,
  isLoading,
  error,
  onRefresh,
  onOpenUploadModal,
  onDelete,
}: ImageGridProps) {
  const {toast} = useToast();
  const [deleteDialog, setDeleteDialog] = useState<{
    isOpen: boolean;
    image: ImageRecord | null;
    isDeleting: boolean;
  }>({isOpen: false, image: null, isDeleting: false});

  const [lightbox, setLightbox] = useState<ImageRecord | null>(null);

  const handleCopyLink = useCallback(
    async (image: ImageRecord) => {
      const origin =
        typeof window !== "undefined" && window.location?.origin ? window.location.origin : "";
      const copyUrl = `${origin}/i/${image.id}`;
      try {
        await navigator.clipboard.writeText(copyUrl);
        toast({title: "Link copied", description: copyUrl, variant: "success"});
      } catch (err) {
        toast({
          title: "Couldn't copy link",
          description: err instanceof Error ? err.message : "Copy failed",
          variant: "error",
        });
      }
    },
    [toast],
  );

  const handleCopyEmbed = useCallback(
    async (imageId: string) => {
      const origin =
        typeof window !== "undefined" && window.location?.origin ? window.location.origin : "";
      const embedUrl = `${origin}/embed/i/${imageId}`;
      const snippet =
        `<div style="width:100%;max-width:100%;margin:0 auto;">\n` +
        `  <iframe src="${embedUrl}"\n` +
        `          style="width:100%;aspect-ratio:1/1;border:0;display:block;"\n` +
        `          loading="lazy"\n` +
        `          referrerpolicy="strict-origin-when-cross-origin"\n` +
        `          title="SAIVD verified image"></iframe>\n` +
        `</div>`;
      try {
        await navigator.clipboard.writeText(snippet);
        toast({title: "Embed code copied", description: "Paste it into your site's HTML.", variant: "success"});
      } catch (err) {
        toast({
          title: "Couldn't copy embed code",
          description: err instanceof Error ? err.message : "Copy failed",
          variant: "error",
        });
      }
    },
    [toast],
  );

  const handleDeleteConfirm = async () => {
    if (!deleteDialog.image) return;
    setDeleteDialog((prev) => ({...prev, isDeleting: true}));
    try {
      await onDelete(deleteDialog.image.id);
      toast({title: "Image deleted", description: `"${deleteDialog.image.filename}" has been deleted.`});
      setDeleteDialog({isOpen: false, image: null, isDeleting: false});
      onRefresh();
    } catch (e) {
      toast({
        title: "Delete failed",
        description: e instanceof Error ? e.message : "Failed to delete image",
        variant: "error",
      });
      setDeleteDialog((prev) => ({...prev, isDeleting: false}));
    }
  };

  if (!isLoading && images.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center bg-white dark:bg-gray-800 rounded-lg shadow">
        <div className="mb-4 p-4 bg-gray-100 dark:bg-gray-700 rounded-full">
          <ImageIcon className="h-8 w-8 text-gray-400" />
        </div>
        <h2 className="text-xl font-semibold mb-2">No images yet</h2>
        <p className="text-gray-500 dark:text-gray-400 mb-6 max-w-md">
          Claim a watermarked image using a share link from a SAIVD creator (Upload → Claim from link).
        </p>
        <Button onClick={onOpenUploadModal}>
          <LinkIcon className="mr-2 h-4 w-4" />
          Claim from link
        </Button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center p-8">
        <LoadingSpinner size="lg" />
        <p className="mt-4 text-gray-500 dark:text-gray-400">Loading images...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center bg-white dark:bg-gray-800 rounded-lg shadow">
        <h2 className="text-xl font-semibold text-red-500 mb-2">Error loading images</h2>
        <p className="text-gray-500 dark:text-gray-400 mb-6">{error}</p>
        <Button onClick={onRefresh} variant="outline">
          <RefreshCwIcon className="mr-2 h-4 w-4" />
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-6 justify-start">
        {images.map((image) => (
          <Card key={image.id} className="overflow-hidden flex-shrink-0 w-fit min-w-0">
            <CardContent className="p-4">
              <div className="mb-3 flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-lg truncate max-w-[240px]" title={image.filename}>
                    {image.filename}
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Uploaded {new Date(image.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                        title={`Share "${image.filename}"`}
                        aria-label="Share image">
                        <LinkIcon className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => void handleCopyLink(image)}>
                        Copy share link
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => void handleCopyEmbed(image.id)}>
                        Copy embed code
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                    onClick={() => setDeleteDialog({isOpen: true, image, isDeleting: false})}
                    title={`Delete "${image.filename}"`}>
                    <TrashIcon className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div
                className="w-60 max-w-[240px] aspect-square relative bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden cursor-pointer hover:opacity-90 transition-opacity"
                onClick={() => setLightbox(image)}>
                {image.original_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={image.original_url}
                    alt={image.filename}
                    className="object-contain w-full h-full"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <span className="text-gray-400 text-xs">No preview</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <DeleteConfirmDialog
        isOpen={deleteDialog.isOpen}
        onClose={() => setDeleteDialog({isOpen: false, image: null, isDeleting: false})}
        onConfirm={handleDeleteConfirm}
        videoFilename={deleteDialog.image?.filename ?? ""}
        mediaKind="image"
        isDeleting={deleteDialog.isDeleting}
      />

      {lightbox && (
        <ImageLightbox
          isOpen
          imageId={lightbox.id}
          filename={lightbox.filename}
          previewUrl={lightbox.original_url}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}
