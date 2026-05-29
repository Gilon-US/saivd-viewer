import {NextRequest, NextResponse} from "next/server";
import {HeadObjectCommand} from "@aws-sdk/client-s3";
import {createClient} from "@/utils/supabase/server";
import {wasabiClient, WASABI_BUCKET} from "@/lib/wasabi";

/** Confirm image in Wasabi — stores watermarked file key in original_url (same as videos). */
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

    const {key, filename, filesize, contentType} = await request.json();
    if (!key || !filename || !filesize || !contentType) {
      return NextResponse.json(
        {success: false, error: {code: "validation_error", message: "Missing required fields"}},
        {status: 400},
      );
    }

    try {
      await wasabiClient.send(new HeadObjectCommand({Bucket: WASABI_BUCKET, Key: key}));
    } catch {
      return NextResponse.json(
        {success: false, error: {code: "not_found", message: "Uploaded file not found in storage"}},
        {status: 404},
      );
    }

    const {data: image, error} = await supabase
      .from("images")
      .insert({
        user_id: user.id,
        filename,
        file_size: filesize,
        content_type: contentType,
        original_url: key,
        status: "uploaded",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error || !image) {
      console.error("[images/confirm] insert failed:", error);
      return NextResponse.json(
        {success: false, error: {code: "database_error", message: "Failed to store image metadata"}},
        {status: 500},
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        id: image.id,
        key,
        filename: image.filename,
        originalUrl: image.original_url,
        createdAt: image.created_at,
      },
    });
  } catch (error) {
    console.error("[images/confirm] unhandled:", error);
    return NextResponse.json(
      {success: false, error: {code: "server_error", message: "Failed to confirm upload"}},
      {status: 500},
    );
  }
}
