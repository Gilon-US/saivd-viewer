'use client';

import { useState, useEffect } from 'react';
import FileUploader from '@/components/FileUploader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { useVideoUpload, UploadResult } from '@/hooks/useVideoUpload';

type VideoUploaderProps = {
  onUploadComplete?: (result: UploadResult) => void;
  className?: string;
  maxSize?: number;
};

export function VideoUploader({ 
  onUploadComplete, 
  className = '',
  maxSize = 500 * 1024 * 1024, // 500MB
}: VideoUploaderProps) {
  const [selectedVideo, setSelectedVideo] = useState<File | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const { uploadVideo, cancelUpload, uploads } = useVideoUpload();
  
  // Generate video thumbnail when a video is selected
  useEffect(() => {
    if (!selectedVideo) {
      setVideoPreviewUrl(null);
      return;
    }
    
    // Create a preview URL for the video
    const url = URL.createObjectURL(selectedVideo);
    setVideoPreviewUrl(url);
    
    // Clean up the URL when component unmounts or video changes
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [selectedVideo]);
  
  const handleFilesSelected = (files: File[]) => {
    const videoFile = files.length > 0 ? files[0] : null;
    setSelectedVideo(videoFile);
    setError(null);
  };
  
  const handleUpload = async () => {
    if (!selectedVideo || isUploading) return; // Prevent multiple clicks
    
    try {
      setError(null);
      const result = await uploadVideo(selectedVideo);
      
      if (onUploadComplete) {
        onUploadComplete(result);
      }
    } catch (err: unknown) {
      // Only set error if it's not an abort error (user cancelled)
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err.message || 'An error occurred during upload');
      } else if (typeof err === 'object' && err !== null && 'message' in err) {
        setError((err as { message: string }).message || 'An error occurred during upload');
      } else {
        setError('An unknown error occurred during upload');
      }
    }
  };
  
  const handleCancel = () => {
    if (currentUpload) {
      cancelUpload(currentUpload.id);
    }
  };
  
  // Find the upload that matches the selected file
  const currentUpload = selectedVideo
    ? Object.values(uploads).find(
        (upload) => upload.file.name === selectedVideo.name &&
        upload.file.size === selectedVideo.size &&
        upload.file.lastModified === selectedVideo.lastModified
      )
    : null;
  const isUploading = currentUpload?.uploading ?? false;
  
  return (
    <div className={`space-y-6 ${className}`}>
      <FileUploader
        accept={{
          'video/*': ['.mp4', '.mov', '.avi', '.webm']
        }}
        maxSize={maxSize}
        onFilesSelected={handleFilesSelected}
      />
      
      {videoPreviewUrl && selectedVideo && (
        <Card>
          <CardContent className="p-4">
            <h3 className="font-medium mb-2">Video Preview</h3>
            <div className="aspect-video relative overflow-hidden rounded-md bg-gray-100 dark:bg-gray-800">
              <video
                controls
                className="w-full h-full object-contain"
                src={videoPreviewUrl}
              >
                Your browser does not support the video tag.
              </video>
            </div>
            <div className="mt-2 text-sm text-gray-500">
              {selectedVideo.name} ({(selectedVideo.size / (1024 * 1024)).toFixed(2)} MB)
            </div>
          </CardContent>
        </Card>
      )}
      
      {selectedVideo && (
        <>
          <div className="flex justify-end space-x-2">
            <Button 
              variant="outline" 
              onClick={() => {
                if (isUploading) {
                  handleCancel();
                }
                setSelectedVideo(null);
              }}
              disabled={isUploading}
            >
              {isUploading ? 'Cancel Upload' : 'Clear'}
            </Button>
            <Button 
              onClick={handleUpload}
              disabled={isUploading}
            >
              {isUploading ? (
                <>
                  <LoadingSpinner size="sm" className="mr-2" />
                  Uploading...
                </>
              ) : (
                'Upload Video'
              )}
            </Button>
          </div>
          
          {isUploading && currentUpload && (
            <Card>
              <CardContent className="p-4 space-y-4">
                <div className="flex items-center gap-3 mb-2">
                  <LoadingSpinner size="sm" />
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-2">
                      <p className="font-medium">Uploading video...</p>
                      <p className="text-sm font-medium text-gray-600 dark:text-gray-400">{currentUpload.progress}%</p>
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{currentUpload.file.name}</p>
                  </div>
                </div>
                <Progress value={currentUpload.progress} className="h-2" />
              </CardContent>
            </Card>
          )}
        </>
      )}
      
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
