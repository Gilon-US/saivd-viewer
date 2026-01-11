'use client';

import { useState } from 'react';
import { VideoUploader } from '@/components/video/VideoUploader';
import { Button } from '@/components/ui/button';
import { XIcon } from 'lucide-react';
import { UploadResult } from '@/hooks/useVideoUpload';

type UploadModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onUploadComplete: (result: UploadResult) => void;
};

export function UploadModal({ isOpen, onClose, onUploadComplete }: UploadModalProps) {
  const [uploadComplete, setUploadComplete] = useState(false);
  
  const handleUploadComplete = (result: UploadResult) => {
    setUploadComplete(true);
    onUploadComplete(result);
  };
  
  const handleClose = () => {
    setUploadComplete(false);
    onClose();
  };
  
  if (!isOpen) {
    return null;
  }
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-xl font-semibold">
            {uploadComplete ? 'Upload Complete' : 'Upload Video'}
          </h2>
          <Button variant="ghost" size="icon" onClick={handleClose}>
            <XIcon className="h-5 w-5" />
          </Button>
        </div>
        
        <div className="p-6">
          {!uploadComplete ? (
            <div className="space-y-4">
              <p className="text-gray-500 dark:text-gray-400 mb-4">
                Select a video to upload. Supported formats: MP4, MOV, AVI, WEBM. Maximum file size: 500MB.
              </p>
              <VideoUploader onUploadComplete={handleUploadComplete} />
            </div>
          ) : (
            <div className="text-center py-6">
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
                <h3 className="text-xl font-semibold text-green-600 dark:text-green-400 mb-2">
                  Upload Complete!
                </h3>
                <p className="text-gray-600 dark:text-gray-400">
                  Your video has been uploaded successfully and is now available in your video library.
                </p>
              </div>
              <div className="flex justify-center gap-3">
                <Button variant="outline" onClick={() => {
                  setUploadComplete(false);
                }}>
                  Upload Another Video
                </Button>
                <Button onClick={handleClose}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
