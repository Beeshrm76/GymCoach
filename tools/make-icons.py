"""Generate the PWA icons with nothing but the standard library (no PIL here).

Draws a dumbbell mark on the app's accent gradient, 3x supersampled so the edges
are smooth, and writes real PNGs:
    assets/icons/icon-192.png          rounded square
    assets/icons/icon-512.png          rounded square
    assets/icons/icon-maskable-512.png full bleed, mark inside the safe zone
"""
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "icons")
SS = 3  # supersample factor

TOP = (0x5C, 0x97, 0xFF)
BOTTOM = (0x25, 0x53, 0xC4)
MARK = (0xFF, 0xFF, 0xFF)


def rounded_rect(x, y, w, h, r):
    """Return a hit-test for a rounded rect in supersampled space."""
    x2, y2 = x + w, y + h
    r = min(r, w / 2, h / 2)

    def hit(px, py):
        if px < x or px > x2 or py < y or py > y2:
            return False

        cx = x + r if px < x + r else (x2 - r if px > x2 - r else px)
        cy = y + r if py < y + r else (y2 - r if py > y2 - r else py)
        return (px - cx) ** 2 + (py - cy) ** 2 <= r * r

    return hit


def build(size, maskable=False):
    """Return (width, height, list of RGB rows) for one icon."""
    s = size * SS
    scale = 0.78 if maskable else 1.0          # keep the mark in the safe zone
    bg_radius = 0 if maskable else 0.22 * s
    in_bg = rounded_rect(0, 0, s, s, bg_radius)

    def u(v):
        """Fraction of the icon -> supersampled pixels, centred, scaled."""
        return (0.5 + (v - 0.5) * scale) * s

    bar_h = 0.088 * s * scale
    cy = 0.5 * s
    shapes = [
        rounded_rect(u(0.305), cy - bar_h / 2, u(0.695) - u(0.305), bar_h, bar_h / 2),
        rounded_rect(u(0.255), cy - 0.170 * s * scale, 0.075 * s * scale, 0.340 * s * scale, 0.022 * s * scale),
        rounded_rect(u(0.670), cy - 0.170 * s * scale, 0.075 * s * scale, 0.340 * s * scale, 0.022 * s * scale),
        rounded_rect(u(0.185), cy - 0.110 * s * scale, 0.055 * s * scale, 0.220 * s * scale, 0.018 * s * scale),
        rounded_rect(u(0.760), cy - 0.110 * s * scale, 0.055 * s * scale, 0.220 * s * scale, 0.018 * s * scale),
    ]

    # Precompute the vertical gradient once per supersampled row.
    grad = [
        tuple(round(TOP[c] + (BOTTOM[c] - TOP[c]) * (sy / (s - 1))) for c in range(3))
        for sy in range(s)
    ]

    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            r = g = b = 0
            for dy in range(SS):
                sy = y * SS + dy
                gr = grad[sy]
                for dx in range(SS):
                    sx = x * SS + dx
                    if not in_bg(sx + 0.5, sy + 0.5):
                        continue  # transparent corner -> leave it black-ish, alpha handles it
                    px = MARK if any(h(sx + 0.5, sy + 0.5) for h in shapes) else gr
                    r += px[0]
                    g += px[1]
                    b += px[2]
            n = SS * SS
            row += bytes((r // n, g // n, b // n))
        rows.append(bytes(row))
    return size, size, rows


def alpha_rows(size, maskable):
    """Separate alpha pass so the rounded corners are actually transparent."""
    s = size * SS
    in_bg = rounded_rect(0, 0, s, s, 0 if maskable else 0.22 * s)
    out = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            hits = sum(
                1
                for dy in range(SS)
                for dx in range(SS)
                if in_bg(x * SS + dx + 0.5, y * SS + dy + 0.5)
            )
            row.append(round(255 * hits / (SS * SS)))
        out.append(bytes(row))
    return out


def write_png(path, size, rgb_rows, a_rows):
    raw = bytearray()
    for rgb, a in zip(rgb_rows, a_rows):
        raw.append(0)  # filter type: none
        for i in range(size):
            raw += rgb[i * 3:i * 3 + 3]
            raw.append(a[i])

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as f:
        f.write(png)
    return len(png)


os.makedirs(OUT, exist_ok=True)
for size, maskable, name in ((192, False, "icon-192.png"),
                             (512, False, "icon-512.png"),
                             (512, True, "icon-maskable-512.png")):
    _, _, rgb = build(size, maskable)
    n = write_png(os.path.join(OUT, name), size, rgb, alpha_rows(size, maskable))
    print("wrote {:<26} {:>7,} bytes".format(name, n))
