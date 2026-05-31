# Image verification parity fixtures

Add watermarked PNG fixtures here for Playwright / manual parity checks:

- `watermarked-srgb-1920x1080.png`
- `watermarked-srgb-4096x2160.png`
- `watermarked-min-265x256.png`
- `watermarked-with-icc-stripped-by-encoder.png`
- `watermarked-with-exif-orientation.png`

Generate via `saivd-backend/watermark_image/embed.py` or export from creator pipeline.

Tests skip when this directory contains no `.png` files.
