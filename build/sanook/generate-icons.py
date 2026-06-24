#!/usr/bin/env python3
"""Generate Sanook AI IDE icons from the user-provided source image.

Expected source file, in priority order:
  1. <repo>/Sanook AI Icon.jpg
  2. <repo>/build/sanook/logo-source/Sanook AI Icon.jpg

The source image is landscape, so the generator creates a square, rounded app-icon
crop centered on the main character, then exports macOS/Windows/Linux/server and
Sanook AI extension icon assets.
"""
from __future__ import annotations

from pathlib import Path
import math
import string
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
SCRIPT_DIR = Path(__file__).resolve().parent
OUT = SCRIPT_DIR / "generated-icons"
SOURCE_CANDIDATES = [
    ROOT / "Sanook AI Icon.jpg",
    SCRIPT_DIR / "logo-source" / "Sanook AI Icon.jpg",
]


def source_path() -> Path:
    for path in SOURCE_CANDIDATES:
        if path.exists():
            return path
    raise FileNotFoundError("Could not find 'Sanook AI Icon.jpg' in repo root or build/sanook/logo-source/")


def load_source() -> Image.Image:
    src = source_path()
    return Image.open(src).convert("RGB")


def square_crop(img: Image.Image) -> Image.Image:
    """Crop the landscape illustration to an app-icon square.

    Slightly left-biased crop keeps the face/upper body readable while retaining
    enough desk/computer context to match the supplied artwork.
    """
    w, h = img.size
    side = min(w, h)
    # Focal point chosen from the supplied 1536x1024 artwork: person + monitor.
    focal_x = 0.48
    focal_y = 0.50
    cx = w * focal_x
    cy = h * focal_y
    left = int(round(cx - side / 2))
    top = int(round(cy - side / 2))
    left = max(0, min(left, w - side))
    top = max(0, min(top, h - side))
    return img.crop((left, top, left + side, top + side))


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size, size), radius=radius, fill=255)
    return mask


def icon(size: int) -> Image.Image:
    # Render high-res then downsample for clean edges.
    scale = 4 if size <= 256 else 2
    canvas = size * scale
    crop = square_crop(load_source()).resize((canvas, canvas), Image.Resampling.LANCZOS).convert("RGBA")

    # Use standard macOS app icon rounded corner radius (~22.5% of size)
    radius = int(canvas * 0.225)
    
    # Apply rounded mask directly to the full bleed cropped image
    out = crop.copy()
    out.putalpha(rounded_mask(canvas, radius))

    return out.resize((size, size), Image.Resampling.LANCZOS)


def save_png(path: Path, size: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    icon(size).save(path)


def write_xpm(path: Path, size: int = 32) -> None:
    """Write a small XPM for RPM metadata using a quantized palette."""
    img = icon(size).convert("RGBA")
    alpha = img.getchannel("A")
    rgb = Image.new("RGB", img.size, (0, 0, 0))
    rgb.paste(img.convert("RGB"), mask=alpha)
    pal = rgb.quantize(colors=63, method=Image.Quantize.MEDIANCUT)
    raw_palette = pal.getpalette()
    if raw_palette is None:
        raise RuntimeError("Pillow did not return an XPM palette")
    palette = raw_palette[:63 * 3]
    symbols = list(string.ascii_letters + string.digits + "!#$%&()*+,-./:;<=>?@[]^_{|}~")
    colors: dict[int, str] = {}
    lines = ["/* XPM */", "static char * sanook_xpm[] = {", f'"{size} {size} 64 1",', '"  c None",']
    for idx in range(63):
        r, g, b = palette[idx * 3:idx * 3 + 3]
        ch = symbols[idx]
        colors[idx] = ch
        lines.append(f'"{ch} c #{r:02x}{g:02x}{b:02x}",')
    pix = pal.load()
    a = alpha.load()
    for y in range(size):
        row = ""
        for x in range(size):
            row += " " if a[x, y] < 16 else colors.get(pix[x, y], "a")
        lines.append(f'"{row}"{"," if y < size - 1 else ""}')
    lines.append("};\n")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf8")


def build_icns(target: Path) -> None:
    iconset = OUT / "Sanook.iconset"
    if iconset.exists():
        for item in iconset.iterdir():
            item.unlink()
    iconset.mkdir(parents=True, exist_ok=True)
    for logical in [16, 32, 128, 256, 512]:
        save_png(iconset / f"icon_{logical}x{logical}.png", logical)
        save_png(iconset / f"icon_{logical}x{logical}@2x.png", logical * 2)
    if sys.platform == "darwin":
        subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(target)], check=True)
    else:
        print("iconutil unavailable outside macOS; generated iconset only", file=sys.stderr)


def main() -> None:
    src = source_path()
    OUT.mkdir(parents=True, exist_ok=True)
    (SCRIPT_DIR / "logo-source").mkdir(parents=True, exist_ok=True)
    if src != SCRIPT_DIR / "logo-source" / "Sanook AI Icon.jpg":
        (SCRIPT_DIR / "logo-source" / "Sanook AI Icon.jpg").write_bytes(src.read_bytes())

    save_png(OUT / "sanook-1024.png", 1024)
    save_png(OUT / "sanook-icon-preview.png", 512)

    # Desktop/platform resources
    save_png(ROOT / "resources/linux/code.png", 512)
    save_png(ROOT / "resources/server/code-192.png", 192)
    save_png(ROOT / "resources/server/code-512.png", 512)
    save_png(ROOT / "resources/win32/code_70x70.png", 70)
    save_png(ROOT / "resources/win32/code_150x150.png", 150)
    icon(256).save(ROOT / "resources/win32/code.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    write_xpm(ROOT / "resources/linux/rpm/code.xpm")
    build_icns(ROOT / "resources/darwin/code.icns")

    print(f"✓ generated Sanook AI IDE icons from {src}")


if __name__ == "__main__":
    main()
