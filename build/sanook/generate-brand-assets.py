#!/usr/bin/env python3
"""Generate Sanook AI IDE app icons from a small procedural mark.

No third-party Python packages are required. On macOS the script uses iconutil to
assemble resources/darwin/code.icns from generated PNGs.
"""
from __future__ import annotations

import math
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DARWIN_ICON = ROOT / "resources" / "darwin" / "code.icns"
LINUX_ICON = ROOT / "resources" / "linux" / "code.png"
WIN_ICO = ROOT / "resources" / "win32" / "code.ico"
WIN_70 = ROOT / "resources" / "win32" / "code_70x70.png"
WIN_150 = ROOT / "resources" / "win32" / "code_150x150.png"

PNG_SIG = b"\x89PNG\r\n\x1a\n"


def chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def write_png(path: Path, width: int, height: int, pixels: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)
        raw.extend(pixels[y * stride : (y + 1) * stride])
    data = PNG_SIG
    data += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    data += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    data += chunk(b"IEND", b"")
    path.write_bytes(data)


def in_round_rect(x: float, y: float, r: float) -> bool:
    # x/y in 0..1
    if r <= x <= 1 - r or r <= y <= 1 - r:
        return True
    cx = r if x < r else 1 - r
    cy = r if y < r else 1 - r
    return (x - cx) ** 2 + (y - cy) ** 2 <= r**2


def in_poly(x: float, y: float, pts: list[tuple[float, float]]) -> bool:
    inside = False
    j = len(pts) - 1
    for i, (xi, yi) in enumerate(pts):
        xj, yj = pts[j]
        if (yi > y) != (yj > y):
            x_at_y = (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi
            if x < x_at_y:
                inside = not inside
        j = i
    return inside


def in_circle(x: float, y: float, cx: float, cy: float, rr: float) -> bool:
    return (x - cx) ** 2 + (y - cy) ** 2 <= rr**2


def lerp(a: int, b: int, t: float) -> int:
    return max(0, min(255, round(a + (b - a) * t)))


def blend(dst: tuple[int, int, int, int], src: tuple[int, int, int, int], coverage: float = 1.0) -> tuple[int, int, int, int]:
    sr, sg, sb, sa = src
    dr, dg, db, da = dst
    a = (sa / 255.0) * coverage
    out_a = a + (da / 255.0) * (1 - a)
    if out_a <= 0:
        return (0, 0, 0, 0)
    return (
        round((sr * a + dr * (da / 255.0) * (1 - a)) / out_a),
        round((sg * a + dg * (da / 255.0) * (1 - a)) / out_a),
        round((sb * a + db * (da / 255.0) * (1 - a)) / out_a),
        round(out_a * 255),
    )


STAR = [
    (0.50, 0.115),
    (0.590, 0.355),
    (0.835, 0.445),
    (0.590, 0.535),
    (0.50, 0.790),
    (0.410, 0.535),
    (0.165, 0.445),
    (0.410, 0.355),
]


def sample_icon(x: float, y: float) -> tuple[int, int, int, int]:
    if not in_round_rect(x, y, 0.205):
        return (0, 0, 0, 0)

    # Purple → blue gradient background with a subtle warm highlight.
    t = (x + y) / 2
    bg = (
        lerp(107, 14, t),
        lerp(33, 165, t),
        lerp(168, 233, t),
        255,
    )
    warm = max(0.0, 1.0 - math.hypot(x - 0.34, y - 0.24) / 0.62)
    px = blend(bg, (255, 190, 72, 70), warm * 0.45)

    # Main sparkle + three memory dots.
    if in_poly(x, y, STAR):
        px = blend(px, (255, 255, 255, 255))
    if in_circle(x, y, 0.295, 0.765, 0.055) or in_circle(x, y, 0.705, 0.765, 0.055) or in_circle(x, y, 0.500, 0.855, 0.043):
        px = blend(px, (255, 246, 210, 255))
    return px


def render_png_bytes(size: int) -> bytes:
    samples = 3 if size <= 256 else 2
    pixels = bytearray(size * size * 4)
    idx = 0
    for y in range(size):
        for x in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(samples):
                for sx in range(samples):
                    r, g, b, a = sample_icon((x + (sx + 0.5) / samples) / size, (y + (sy + 0.5) / samples) / size)
                    acc[0] += r
                    acc[1] += g
                    acc[2] += b
                    acc[3] += a
            denom = samples * samples
            pixels[idx : idx + 4] = bytes(round(v / denom) for v in acc)
            idx += 4
    raw = bytearray()
    stride = size * 4
    for y in range(size):
        raw.append(0)
        raw.extend(pixels[y * stride : (y + 1) * stride])
    data = PNG_SIG
    data += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    data += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    data += chunk(b"IEND", b"")
    return data


def write_icon_png(path: Path, size: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(render_png_bytes(size))


def write_ico(path: Path, sizes: list[int]) -> None:
    images = [(size, render_png_bytes(size)) for size in sizes]
    header = struct.pack("<HHH", 0, 1, len(images))
    offset = 6 + 16 * len(images)
    entries = bytearray()
    payload = bytearray()
    for size, data in images:
        width = 0 if size >= 256 else size
        entries.extend(struct.pack("<BBBBHHII", width, width, 0, 0, 1, 32, len(data), offset))
        payload.extend(data)
        offset += len(data)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(header + bytes(entries) + bytes(payload))


def write_icns(path: Path) -> None:
    iconutil = shutil.which("iconutil")
    if not iconutil:
        raise SystemExit("iconutil not found; run this on macOS to generate resources/darwin/code.icns")
    with tempfile.TemporaryDirectory(prefix="sanook-iconset-") as tmp:
        iconset = Path(tmp) / "code.iconset"
        iconset.mkdir()
        mapping = {
            "icon_16x16.png": 16,
            "icon_16x16@2x.png": 32,
            "icon_32x32.png": 32,
            "icon_32x32@2x.png": 64,
            "icon_128x128.png": 128,
            "icon_128x128@2x.png": 256,
            "icon_256x256.png": 256,
            "icon_256x256@2x.png": 512,
            "icon_512x512.png": 512,
            "icon_512x512@2x.png": 1024,
        }
        cache: dict[int, bytes] = {}
        for name, size in mapping.items():
            cache.setdefault(size, render_png_bytes(size))
            (iconset / name).write_bytes(cache[size])
        subprocess.run([iconutil, "-c", "icns", str(iconset), "-o", str(path)], check=True)


def main() -> None:
    write_icon_png(LINUX_ICON, 1024)
    write_icon_png(WIN_70, 70)
    write_icon_png(WIN_150, 150)
    write_ico(WIN_ICO, [16, 32, 48, 64, 128, 256])
    write_icns(DARWIN_ICON)
    for path in [DARWIN_ICON, LINUX_ICON, WIN_ICO, WIN_70, WIN_150]:
        print(f"✓ {path.relative_to(ROOT)}")


if __name__ == "__main__":
    os.chdir(ROOT)
    main()
