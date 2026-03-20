# V2 Watermark Strategy (saivd-viewer)

`saivd-viewer` verifies watermark authenticity entirely in-browser using V2.

## Bootstrap

- Decode user id from keyless right-side payload using marker-aware V2 decode.
- V2 bootstrap frames: `0,1,2` (encoded redundancy).
- Fetch RSA public key using decoded user id.
- Require bootstrap verification success before playback.

## Continuous verification

- Verify every 10th frame during playback.
- Reuse imported RSA key for all checkpoints.
- Policy:
  - first inconclusive checkpoint: grace
  - second consecutive inconclusive checkpoint: fail/stop
  - cryptographic mismatch: immediate fail/stop

## Payload

- Right-side prefix: calibration marker `059059`, then 9-digit user id.
- Left-side: 256-byte signature from column-major 5-pixel groups.

Canonical format is defined in `saivd-backend/docs/V2_WATERMARK_SPEC.md`.
