import {NextRequest, NextResponse} from "next/server";
import {createClient} from "@/utils/supabase/server";
import {createPresignedPost} from "@aws-sdk/s3-presigned-post";
import {
  wasabiClient,
  WASABI_BUCKET,
  URL_EXPIRATION_SECONDS,
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_SIZE,
} from "@/lib/wasabi";
import {v4 as uuidv4} from "uuid";

/** Presigned POST for claim pipeline (and future uploads). PNG preferred for watermarks. */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: {user},
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        {success: false, error: {code: "unauthorized", message: "Authentication required"}},
        {status: 401},
      );
    }

    const {filename, contentType, filesize} = await request.json();
    if (!filename || !contentType || !filesize) {
      return NextResponse.json(
        {success: false, error: {code: "validation_error", message: "Missing required fields"}},
        {status: 400},
      );
    }

    if (!ALLOWED_IMAGE_TYPES.includes(contentType)) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "validation_error",
            message: `Invalid file type. Supported: ${ALLOWED_IMAGE_TYPES.join(", ")}`,
          },
        },
        {status: 400},
      );
    }

    if (filesize > MAX_IMAGE_SIZE) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "validation_error",
            message: `File too large. Maximum size: ${MAX_IMAGE_SIZE / (1024 * 1024)}MB`,
          },
        },
        {status: 400},
      );
    }

    const ext = filename.split(".").pop() ?? "png";
    const key = `images/${user.id}/${Date.now()}-${uuidv4()}.${ext}`;

    const presignedPost = await createPresignedPost(wasabiClient, {
      Bucket: WASABI_BUCKET,
      Key: key,
      Fields: {"Content-Type": contentType},
      Conditions: [
        ["content-length-range", 0, MAX_IMAGE_SIZE],
        ["starts-with", "$Content-Type", "image/"],
      ],
      Expires: URL_EXPIRATION_SECONDS,
    });

    return NextResponse.json({
      success: true,
      data: {uploadUrl: presignedPost.url, fields: presignedPost.fields, key},
    });
  } catch (error) {
    console.error("[images/upload] failed:", error);
    return NextResponse.json(
      {success: false, error: {code: "server_error", message: "Failed to create upload URL"}},
      {status: 500},
    );
  }
}
