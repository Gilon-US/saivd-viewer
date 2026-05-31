import {NextRequest, NextResponse} from "next/server";

type TelemetryPayload = {
  imageId?: string;
  videoId?: string;
  kind?: string;
  phases?: Record<string, number>;
  path?: string;
  outcome?: string;
  event?: string;
  ua?: string;
  [key: string]: unknown;
};

/** POST /api/internal/verify-telemetry — sampled verification timing (no presigned URLs). */
export async function POST(request: NextRequest) {
  const secret = process.env.VERIFY_TELEMETRY_SECRET;
  if (secret) {
    const header = request.headers.get("x-verify-telemetry-secret");
    if (header !== secret) {
      return NextResponse.json(
        {success: false, error: {code: "unauthorized", message: "Invalid telemetry secret"}},
        {status: 401},
      );
    }
  }

  let body: TelemetryPayload;
  try {
    body = (await request.json()) as TelemetryPayload;
  } catch {
    return NextResponse.json(
      {success: false, error: {code: "validation_error", message: "Invalid JSON"}},
      {status: 400},
    );
  }

  if (!body.imageId && !body.videoId) {
    return NextResponse.json(
      {success: false, error: {code: "validation_error", message: "imageId or videoId required"}},
      {status: 400},
    );
  }

  if (process.env.NODE_ENV !== "production") {
    console.info("[verify-telemetry]", JSON.stringify(body));
  } else {
    const id = body.videoId ?? body.imageId;
    console.info("[verify-telemetry]", id, body.kind ?? body.path ?? body.event ?? "mark", body.outcome ?? "");
  }

  return NextResponse.json({success: true});
}
