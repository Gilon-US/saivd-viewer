# SAIVD Viewer Docs Index

This folder contains technical and implementation documentation for `saivd-viewer`.

## Current docs

- `V2_WATERMARK_STRATEGY.md`  
  Current in-browser watermark verification policy (bootstrap + every-10th-frame checks).
- `FRONTEND_WATERMARK_VERIFICATION_IMPLEMENTATION_GUIDE.md`  
  End-to-end frontend decode and verification implementation details.
- `THIRD_PARTY_NEXTJS_APP_IMPLEMENTATION_GUIDE.md`  
  Integration guidance for third-party Next.js apps consuming viewer verification behavior.
- `WATERMARK_DATA_AND_DECODING_GUIDE.md`  
  Watermark payload and decoding reference used by frontend verification code.
- `video-playback-fix.md`  
  Playback-specific troubleshooting/fix notes.
- `thumbnail-generation-implementation.md`  
  Thumbnail generation behavior used by upload/list flows.
- `qr-logo-flip-animation-implementation-guide.md`  
  QR/logo animation implementation details.

## Deprecated docs

Any file prefixed with `deprecated-` is historical or no longer aligned with the current viewer-only implementation (for example:
- legacy full-app architecture/PRD/story docs,
- removed watermarking-orchestration docs,
- migration planning artifacts).
