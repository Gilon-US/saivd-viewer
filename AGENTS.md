# AGENTS.md — SAIVD Viewer

Context and instructions for AI coding assistants working on this codebase.

---

## 1. Project Overview

**SAIVD Viewer** is a **viewer/player-only** application for uploading, viewing, and verifying watermarked videos. It does **not** create or apply watermarks; it displays videos and extracts creator user IDs from watermarked content via an external API.

- **Purpose**: Upload videos (pre-watermarked elsewhere), play them, verify authenticity, and show a QR code overlay derived from the embedded user ID.
- **Stack**: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS, Supabase (Auth + PostgreSQL), Wasabi (S3-compatible storage).
- **Deployment**: Netlify (Node 20), Docker optional.

---

## 2. Repository Structure

```
src/
├── app/
│   ├── (auth)/                    # Auth route group (no layout segment in URL)
│   │   ├── login/page.tsx
│   │   ├── register/page.tsx
│   │   ├── forgot-password/page.tsx
│   │   └── reset-password/page.tsx
│   ├── dashboard/
│   │   ├── layout.tsx             # Auth-protected dashboard layout
│   │   ├── page.tsx               # Dashboard overview
│   │   ├── videos/page.tsx        # Main video grid
│   │   └── upload/page.tsx        # Dedicated upload page
│   ├── profile/[userId]/          # Public profile page (if implemented)
│   ├── api/
│   │   ├── videos/
│   │   │   ├── route.ts           # GET list, POST create
│   │   │   ├── upload/route.ts    # Pre-signed upload URL
│   │   │   ├── confirm/route.ts   # Confirm upload completion
│   │   │   └── [id]/
│   │   │       ├── route.ts       # GET/DELETE single video
│   │   │       └── play/route.ts  # Presigned playback URL (?variant=watermarked)
│   │   ├── profile/[userId]/      # Public profile API (if implemented)
│   │   ├── health/route.ts
│   │   └── auth-test/route.ts
│   ├── layout.tsx
│   ├── page.tsx                   # Root → redirects based on auth
│   └── globals.css
├── components/
│   ├── auth/                      # LoginForm, RegisterForm, AuthGuard, LogoutButton, etc.
│   ├── video/                     # VideoGrid, VideoPlayer, VideoUploader, UploadModal, DeleteConfirmDialog
│   └── ui/                        # Shadcn UI (button, card, input, loading-spinner, etc.)
├── contexts/
│   └── AuthContext.tsx            # Auth state, signIn, signUp, signOut
├── hooks/
│   ├── useVideos.ts               # Fetch videos with pagination
│   ├── useVideoUpload.ts          # Upload flow (presigned URL → Wasabi → confirm)
│   ├── useFrameAnalysis.ts        # Ongoing verification every 10th frame during playback
│   └── useToast.ts
├── lib/
│   ├── wasabi.ts                  # S3 client; uses WASABI_BUCKET (from WASABI_BUCKET_NAME)
│   ├── wasabi-urls.ts             # Presigned URLs, key extraction
│   ├── watermark-decode.ts        # Client-side decode + RSA verify (see FRONTEND_WATERMARK_VERIFICATION_IMPLEMENTATION_GUIDE)
│   ├── watermark-api.ts           # Legacy error helpers (optional)
│   ├── auth.ts
│   └── utils.ts
├── utils/
│   ├── supabase/                  # client.ts, server.ts, middleware.ts
│   ├── videoThumbnail.ts          # Browser-based thumbnail generation
│   └── validation.ts
├── db/
│   ├── setup-videos.ts
│   ├── setup-profiles.ts
│   └── schema/
└── middleware.ts                  # Delegates to utils/supabase/middleware.ts
```

---

## 3. Build and Test Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server (Turbopack) |
| `npm run build` | Production build |
| `npm run start` | Run production server |
| `npm test` | Run Jest tests |
| `npm run test:watch` | Jest watch mode |
| `npm run test:coverage` | Coverage report |
| `npm run lint` | ESLint |

**Before commits**: Run `npm test && npm run lint`. Ensure no build errors with `npm run build`.

---

## 4. Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server) | For DB setup only |
| `NEXT_PUBLIC_SAIVD_API_URL` | Base URL for external SAIVD API (public key, profile/QR). Default `https://saivd.netlify.app` | No |
| `WASABI_REGION` | Wasabi region | Yes |
| `WASABI_ENDPOINT` | Wasabi S3 endpoint (e.g. `https://s3.us-east-1.wasabisys.com`) | Yes |
| `WASABI_ACCESS_KEY_ID` | Wasabi access key | Yes |
| `WASABI_SECRET_ACCESS_KEY` | Wasabi secret key | Yes |
| `WASABI_BUCKET_NAME` | Wasabi bucket | Yes (exported as `WASABI_BUCKET` in `lib/wasabi.ts`) |
| `WATERMARK_SERVICE_URL` | External watermark API (legacy; not used for verification) | No |
| `WATERMARK_SERVICE_API_KEY` | Optional bearer token for watermark API | No |

Copy `.env.example` to `.env.local` and fill in values.

---

## 5. Database Schema (Supabase)

### `videos`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK, default uuid_generate_v4() |
| user_id | uuid | FK → auth.users |
| filename, filesize, content_type | text/bigint | |
| original_url | text | Required |
| original_thumbnail_url | text | Nullable |
| preview_thumbnail_data | text | Nullable, base64 |
| processed_url | text | Nullable; watermarked URL (fallback to original_url when null) |
| processed_thumbnail_url | text | Nullable |
| status | text | 'uploaded' \| 'processing' \| 'processed' \| 'failed' |
| upload_date | timestamptz | |
| created_at, updated_at | timestamptz | |

**Important**: This app only handles watermarked videos. When `processed_url` is null, the code uses `original_url` as the playable/watermarked source (see play route).

### `profiles`

Defined in `src/db/schema/profiles.sql`. Run `npx tsx src/db/setup-profiles.ts` to apply. This app does not store public keys; they are fetched from the external SAIVD API.

---

## 6. Authentication and Middleware

- **Auth**: Supabase Auth via `@supabase/ssr` and `createClient` from `utils/supabase/client.ts` (browser) and `utils/supabase/server.ts` (server).
- **Auth context**: `AuthContext` provides `user`, `session`, `signIn`, `signUp`, `signOut`, `refreshSession`.
- **Protected routes**: `/dashboard/*`, `/videos/*` require auth; unauthenticated users redirect to `/login`.
- **Auth routes**: `/login`, `/register` redirect to `/dashboard/videos` if already logged in.
- **API protection**: Most `/api/*` routes require auth. Exceptions: `/api/health`, `/api/auth*`, `/api/videos/upload`, `/api/callbacks`. Add `/api/profile/*` if public profile API exists.
- **Password reset**: Forgot password → `resetPasswordForEmail` with `redirectTo: origin/reset-password`. Reset page uses `updateUser({ password })`; Supabase reads recovery token from URL hash.

**Do not add logic between `createServerClient` and `supabase.auth.getUser()` in middleware** — can cause random logouts.

---

## 7. Video Upload Flow

1. **Client**: `VideoUploader` → `useVideoUpload` → calls `POST /api/videos/upload` with `filename`, `contentType`.
2. **API**: Returns `uploadUrl` (presigned POST), `fields`, `videoId`.
3. **Client**: Uploads file directly to Wasabi via presigned POST.
4. **Client**: Calls `POST /api/videos/confirm` with `videoId`, `originalUrl`, `thumbnailUrl`, etc.
5. **API**: Creates/updates `videos` row, sets `original_url`, `original_thumbnail_url`, etc.

Thumbnail generation is client-side in `utils/videoThumbnail.ts` (canvas + video element). Supports portrait/landscape; handle MOV/MP4 keyframes with `seekTime` and short delay after `seeked`.

---

## 8. Video Playback and QR Code

1. **Grid**: User clicks thumbnail → `GET /api/videos/[id]/play?variant=watermarked` → receives presigned URL.
2. **Player**: `VideoPlayer` opens with that URL. Video has `crossOrigin="anonymous"`.
3. **Verification**: Frame 0 verification **must use WebCodecs** (Y channel from codec; canvas-derived luma is not used). Range request(s) → JS demux (mp4box) → VideoDecoder → Y plane → crop to 16; see `docs/FRONTEND_WATERMARK_VERIFICATION_IMPLEMENTATION_GUIDE.md` §3.4. Supports faststart and non-faststart MP4. Verification runs **before** setting `video.src`; on success the app sets `video.src` and marks verified. If WebCodecs is unsupported or fails (demux/decode/timeout), playback is **blocked** and a failure message is shown (no canvas fallback). Decoded `numeric_user_id` is used to fetch the public key from the **external** SAIVD API: `GET {NEXT_PUBLIC_SAIVD_API_URL}/api/users/{numericUserId}/public-key`. RSA verification is required for frame 0. Ongoing verification (every 10th frame during playback) is **not** implemented (would require WebCodecs per-frame capture).
4. **Ongoing verification**: During playback, `useFrameAnalysis` runs every 10th frame (10, 20, 30, …): capture frame, build right_side and left_side, run **signature verification** with the already-fetched public key; if verify returns false → set `verificationFailed`, VideoPlayer pauses and shows "not authentic".
5. **QR URL**: Uses the **numeric** user ID decoded from frame 0: `{NEXT_PUBLIC_SAIVD_API_URL}/profile/{numericUserId}/qr`.
6. **Overlay**: QR code + logo flip animation (see `docs/qr-logo-flip-animation-implementation-guide.md`). Shown only when `verificationStatus === "verified"` and `qrUrl` is set.

**Public keys**: This app does not expose or store public keys. It calls the external SAIVD API (saivd.netlify.app, or `NEXT_PUBLIC_SAIVD_API_URL`) once per playback to get the public key for the decoded `numeric_user_id`; that key is then used only in the browser for verification. See `docs/FRONTEND_WATERMARK_VERIFICATION_IMPLEMENTATION_GUIDE.md`.

---

## 9. Code Style and Conventions

- **TypeScript**: Strict typing; avoid `any`.
- **Components**: Functional components with hooks. Use `"use client"` where needed (forms, context consumers, video player).
- **API responses**: Use consistent shape: `{ success: boolean, data?: T, error?: { code: string, message: string } }`.
- **Imports**: Use `@/` path alias for `src/`.
- **UI**: Shadcn UI + Tailwind. Prefer existing components (Button, Card, Input, LoadingSpinner).
- **Toasts**: Sonner via `toast.success`, `toast.error`, etc.
- **ESLint**: `@next/next/no-img-element` may be disabled for specific `<img>` where Next.js Image is not suitable (e.g. external QR URL).

---

## 10. Key Gotchas

| Gotcha | Resolution |
|--------|------------|
| `watermarked_not_available` | Use `processed_url ?? original_url` for watermarked playback. |
| Verification requires WebCodecs | Decoding uses WebCodecs Y plane only; canvas is not used for verification. |
| Netlify build fails (Node version) | Requires Node 20. Set `NODE_VERSION=20` and `AWS_LAMBDA_JS_RUNTIME=nodejs20.x` in `netlify.toml`. |
| Upload spinner not showing | Match `currentUpload` by file properties (name, size, lastModified) from `uploads` map; don't rely on internal `uploadId` state. |
| Portrait/MOV thumbnails broken | Use `object-contain`, `seekTime` ≥ 0.5s, delay after `seeked`, handle canvas aspect ratio. |
| Reset password prerender error | Avoid `useSearchParams` in ResetPasswordForm; Supabase reads token from URL hash. |
| `WASABI_BUCKET_NAME` vs `WASABI_BUCKET` | Use `WASABI_BUCKET` from `lib/wasabi.ts`; it is derived from `WASABI_BUCKET_NAME`. |

---

## 11. Testing

- **Framework**: Jest + React Testing Library.
- **Location**: `__tests__` folders next to source (e.g. `hooks/__tests__/useFrameAnalysis.test.ts`).
- **Mocks**: Mock fetch, Supabase client, and external APIs. Do not hit real Wasabi or watermark service.
- **Coverage**: Components (VideoGrid, VideoPlayer, VideoUploader, UploadModal), hooks (useVideoUpload, useFrameAnalysis), API routes (videos, upload, confirm).

---

## 12. Documentation Index

| Document | Purpose |
|----------|---------|
| `docs/THIRD_PARTY_NEXTJS_APP_IMPLEMENTATION_GUIDE.md` | Third-party playback/verification flow, block play until verify, QR URL, constants (§5) |
| `docs/FRONTEND_WATERMARK_VERIFICATION_IMPLEMENTATION_GUIDE.md` | Client-side decode, WebCodecs-only frame 0 (§3.4), public-key API, RSA verify |
| `docs/video-player-implementation-guide.md` | Frame analysis, verification, QR logic (may reference legacy extract-user-id) |
| `docs/qr-logo-flip-animation-implementation-guide.md` | QR/logo overlay CSS and React structure |
| `docs/watermark-api-integration-guide.md` | External watermark API contract |
| `docs/thumbnail-generation-implementation.md` | Thumbnail generation details |
| `docs/technical-architecture.md` | System overview, data flow |
| `docs/database-schema.md` | Schema reference (may differ from live DB) |
| `README.md` | User-facing setup and usage |

---

## 13. Constraints for Agents

- **Do not** add creator/watermarking features (start watermark job, queue status, RSA keys). This is viewer-only.
- **Do not** add "original video" vs "watermarked" UI choices; all playback is watermarked (or fallback to original).
- **Do not** hardcode API keys, tokens, or secrets. Use environment variables.
- **Do not** modify `createServerClient` / `getUser` ordering in Supabase middleware.
- **Do** preserve the API response shape `{ success, data?, error? }` for consistency.
- **Do** run tests and build before considering a change complete.
