import {NextRequest, NextResponse} from "next/server";

type TelemetryPayload = {
  imageId?: string;
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

  if (!body.imageId || typeof body.imageId !== "string") {
    return NextResponse.json(
      {success: false, error: {code: "validation_error", message: "imageId required"}},
      {status: 400},
    );
  }

  if (process.env.NODE_ENV !== "production") {
    console.info("[verify-telemetry]", JSON.stringify(body));
  } else {
    console.info("[verify-telemetry]", body.imageId, body.path ?? body.event ?? "mark", body.outcome ?? "");
  }

  return NextResponse.json({success: true});
}
