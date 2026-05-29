import {useToast} from "@/hooks/useToast";

export type ImageUploadResult = {
  id: string;
  key: string;
  filename: string;
  originalUrl: string;
  createdAt: string;
};

export function useImageUpload() {
  const {toast} = useToast();

  const uploadImage = async (file: File): Promise<ImageUploadResult> => {
    const abortController = new AbortController();

    try {
      const getUrlResponse = await fetch("/api/images/upload", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          filesize: file.size,
        }),
        credentials: "include",
        signal: abortController.signal,
      });

      if (!getUrlResponse.ok) {
        const errorData = await getUrlResponse.json().catch(() => ({}));
        throw new Error(errorData.error?.message ?? "Failed to get upload URL");
      }

      const {
        data: {uploadUrl, fields, key},
      } = await getUrlResponse.json();

      await uploadToWasabi(uploadUrl, fields, file, abortController);

      const confirmResponse = await fetch("/api/images/confirm", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          key,
          filename: file.name,
          filesize: file.size,
          contentType: file.type,
        }),
        credentials: "include",
        signal: abortController.signal,
      });

      if (!confirmResponse.ok) {
        const errorData = await confirmResponse.json().catch(() => ({}));
        throw new Error(errorData.error?.message ?? "Failed to confirm upload");
      }

      const {data} = await confirmResponse.json();

      toast({
        title: "Image added",
        description: `"${file.name}" is now in your image library.`,
        variant: "success",
      });

      return data;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "An error occurred during upload.",
        variant: "error",
      });
      throw error;
    }
  };

  return {uploadImage};
}

async function uploadToWasabi(
  url: string,
  fields: Record<string, string>,
  file: File,
  abortController: AbortController,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed with status ${xhr.status}`));
    });
    xhr.addEventListener("error", () => reject(new Error("Network error during upload")));
    xhr.addEventListener("abort", () => reject(new Error("Upload aborted")));
    const formData = new FormData();
    Object.entries(fields).forEach(([k, v]) => formData.append(k, v));
    formData.append("file", file);
    xhr.open("POST", url);
    xhr.send(formData);
    abortController.signal.addEventListener("abort", () => xhr.abort());
  });
}
