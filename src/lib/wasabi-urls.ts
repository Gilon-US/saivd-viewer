import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { wasabiClient, WASABI_BUCKET } from './wasabi';

/**
 * Generate a presigned URL for accessing a video file in Wasabi storage
 * 
 * @param key - The S3 key of the video file
 * @param expiresIn - URL expiration time in seconds (default: 1 hour)
 * @returns A presigned URL that can be used to access the video
 */
export async function generatePresignedVideoUrl(
  key: string,
  expiresIn: number = 3600
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: WASABI_BUCKET,
    Key: key,
  });

  try {
    const presignedUrl = await getSignedUrl(wasabiClient, command, {
      expiresIn,
    });
    return presignedUrl;
  } catch (error) {
    console.error('Error generating presigned URL:', error);
    throw new Error('Failed to generate video access URL');
  }
}

/**
 * Generate a public URL for a video file in Wasabi storage
 * Note: This only works if the bucket has public read access enabled
 * 
 * @param key - The S3 key of the video file
 * @returns A public URL to access the video
 */
export function generatePublicVideoUrl(key: string): string {
  const endpoint = process.env.WASABI_ENDPOINT?.replace('https://', '') || 's3.wasabisys.com';
  const url = `https://${WASABI_BUCKET}.${endpoint}/${key}`;
  
  // Debug: Log URL generation details
  console.log('generatePublicVideoUrl:', {
    key,
    endpoint_env: process.env.WASABI_ENDPOINT,
    endpoint_used: endpoint,
    bucket: WASABI_BUCKET,
    generated_url: url,
  });
  
  return url;
}

/**
 * Extract the S3 key from a Wasabi URL
 * 
 * @param url - The full Wasabi URL
 * @returns The S3 key, or null if the URL is invalid
 */
export function extractKeyFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);
    // Remove leading slash from pathname
    return urlObj.pathname.substring(1);
  } catch {
    return null;
  }
}
