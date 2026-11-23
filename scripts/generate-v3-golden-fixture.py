"""
Generate a golden v3 watermark fixture for the viewer's TypeScript reader (src/lib/watermark-v3.ts).

Runs the saivd-backend reference embedder (watermark_v3.watermark_frame_v3) on a synthetic yuv420p frame and
writes the watermarked planes plus the values the reader must recover. The frame is never encoded, so it
checks the bit layout, RS, CRC and signature exactly; encode drift is covered by the backend's own tests.

Usage (from the viewer repo root):
    python scripts/generate-v3-golden-fixture.py --backend ../saivd-backend

Outputs src/lib/__tests__/fixtures/v3/frame-<W>x<H>.yuv.gz and frame-<W>x<H>.json.
Test-only key: saivd-backend/tests/fixtures/image_watermark/client_key.pem.
"""
import argparse
import gzip
import json
import sys
from pathlib import Path

import numpy as np

USER_ID = 123456789
FRAME_COUNT = 1234
SIZES = [(854, 480), (480, 854)]


def synthetic_frame(width, height, seed):
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float64)
    y = 110 + 40 * np.sin(xx / 37.0) * np.cos(yy / 53.0) + 25 * (xx / width) + rng.normal(0, 0.6, (height, width))
    cw, ch = (width + 1) // 2, (height + 1) // 2
    cy, cx = np.mgrid[0:ch, 0:cw].astype(np.float64)
    u = 128 + 18 * np.sin(cx / 21.0) + rng.normal(0, 0.4, (ch, cw))
    v = 128 + 18 * np.cos(cy / 17.0) + rng.normal(0, 0.4, (ch, cw))
    to_u8 = lambda a: np.clip(np.round(a), 0, 255).astype(np.uint8)
    return to_u8(y), to_u8(u), to_u8(v)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--backend", required=True, help="path to the saivd-backend repo")
    ap.add_argument("--out", default="src/lib/__tests__/fixtures/v3")
    args = ap.parse_args()

    backend = Path(args.backend).resolve()
    sys.path.insert(0, str(backend))
    from cryptography.hazmat.primitives import serialization
    from watermark_video import signature_codec as sc
    from watermark_video import watermark_v3 as w3

    key_pem = (backend / "tests/fixtures/image_watermark/client_key.pem").read_bytes()
    private_key = serialization.load_pem_private_key(key_pem, password=None)
    public_pem = private_key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    ).decode("ascii")

    signature = sc.sign_v3(private_key, FRAME_COUNT, USER_ID)
    sig_bits = sc.signature_to_bits(signature)
    coded = np.packbits(sig_bits).tobytes()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for i, (width, height) in enumerate(SIZES):
        y, u, v = synthetic_frame(width, height, seed=7 + i)
        wy, wu, wv = w3.watermark_frame_v3(y, u, v, 0, USER_ID, sig_bits)
        reading = w3.extract_frame_v3(wy, wu, wv, 0, private_key.public_key(), FRAME_COUNT)
        assert reading.user_id_uv == USER_ID and reading.user_id_y == USER_ID, reading
        assert reading.signature == signature and reading.signature_verified, "backend self-check failed"
        layout = w3.v3_layout(height, width)

        stem = f"frame-{width}x{height}"
        raw = wy.tobytes() + wu.tobytes() + wv.tobytes()
        (out / f"{stem}.yuv.gz").write_bytes(gzip.compress(raw, compresslevel=9, mtime=0))
        meta = {
            "generator": "scripts/generate-v3-golden-fixture.py",
            "width": width,
            "height": height,
            "planes": "yuv420p packed: Y (W*H), U and V (ceil(W/2)*ceil(H/2)) each",
            "userId": USER_ID,
            "frameCount": FRAME_COUNT,
            "message": sc.v3_message(FRAME_COUNT, USER_ID).decode("utf-8"),
            "signatureHex": signature.hex(),
            "codedHex": coded.hex(),
            "publicKeyPem": public_pem,
            "layout": {
                "rows": layout.rows,
                "cols": layout.cols,
                "payloadEnd": layout.payload_end,
                "ySigCapacity": layout.y_sig_capacity,
                "uvSigCapacity": layout.uv_sig_capacity,
                "userIdCopiesPerPlane": layout.user_id_copies_per_plane,
                "uvBits": layout.uv_bits,
            },
        }
        (out / f"{stem}.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
        print(f"wrote {stem}: {len(raw)} raw bytes")


if __name__ == "__main__":
    main()
