'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { VideoUploader } from '@/components/video/VideoUploader';
import { Button } from '@/components/ui/button';
import { ArrowLeftIcon } from 'lucide-react';
import { UploadResult } from '@/hooks/useVideoUpload';

export default function UploadPage() {
  const [uploadComplete, setUploadComplete] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const router = useRouter();
  
  const handleUploadComplete = (result: UploadResult) => {
    setUploadResult(result);
    setUploadComplete(true);
  };
  
  const handleViewVideos = () => {
    router.push('/dashboard/videos');
  };
  
  const handleUploadAnother = () => {
    setUploadComplete(false);
    setUploadResult(null);
  };

  return (
    <div className="container mx-auto py-8 max-w-3xl">
      <div className="flex items-center mb-6">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeftIcon className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-bold ml-2">Upload Video</h1>
      </div>
      
      {!uploadComplete ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Select a video to upload</h2>
          <p className="text-gray-500 dark:text-gray-400 mb-6">
            Supported formats: MP4, MOV, AVI, WEBM. Maximum file size: 500MB.
          </p>
          
          <VideoUploader onUploadComplete={handleUploadComplete} />
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 text-center">
          <div className="mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/20 mb-4">
              <svg
                className="w-8 h-8 text-green-600 dark:text-green-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h2 className="text-2xl font-semibold text-green-600 dark:text-green-400 mb-2">
              Upload Complete!
            </h2>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              Your video has been uploaded successfully and is now available in your video library.
            </p>
            {uploadResult && (
              <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg text-left max-w-md mx-auto">
                <h3 className="font-medium mb-2 text-gray-900 dark:text-gray-100">Video Details</h3>
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  <span className="font-medium">Filename:</span> {uploadResult.filename}
                </p>
              </div>
            )}
          </div>
          <div className="flex justify-center gap-3">
            <Button variant="outline" onClick={handleUploadAnother}>
              Upload Another Video
            </Button>
            <Button onClick={handleViewVideos}>
              View My Videos
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
