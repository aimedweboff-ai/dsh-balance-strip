"""Render a README preview of the dsh-balance-strip bar (dark and light)."""

from PIL import Image, ImageDraw, ImageFont

REGULAR = "C:/Windows/Fonts/segoeui.ttf"
BOLD = "C:/Windows/Fonts/segoeuib.ttf"

W = 1040
HALF = 120
PAD = 26

DARK = dict(page="#111317", panel="#171a1f", strip="#15181d", line="#2a2f37",
            label="#8b9099", strong="#e8eaed", faint="#5b616b")
LIGHT = dict(page="#f6f7f9", panel="#ffffff", strip="#ffffff", line="#e2e5e9",
             label="#8a8f96", strong="#1b1d21", faint="#a9aeb6")


def font(size, bold=False):
    return ImageFont.truetype(BOLD if bold else REGULAR, size)


def render_half(palette, title, path):
    img = Image.new("RGB", (W, HALF), palette["page"])
    d = ImageDraw.Draw(img)

    d.rounded_rectangle([PAD, 8, W - PAD, HALF - 6], radius=10,
                        fill=palette["panel"], outline=palette["line"], width=1)
    d.text((PAD + 18, 25), title, font=font(11), fill=palette["faint"], anchor="lm")

    # faint skeleton transcript so the strip reads as part of the frame
    d.rounded_rectangle([PAD + 18, 42, PAD + 18 + 300, 50], radius=4, fill=palette["line"])
    d.rounded_rectangle([PAD + 18, 56, PAD + 18 + 190, 64], radius=4, fill=palette["line"])

    strip_top = 70
    d.rounded_rectangle([PAD + 1, strip_top, W - PAD - 1, HALF - 7], radius=9, fill=palette["strip"])
    d.line([(PAD + 1, strip_top), (W - PAD - 1, strip_top)], fill=palette["line"], width=1)

    parts = [
        ("↑ ", "strong"), ("901k", "strong"), ("  ", "label"),
        ("↓ ", "strong"), ("345", "strong"),
        ("   ·   ", "faint"),
        ("≈", "label"), ("$0.0062", "strong"),
        ("   ·   ", "faint"),
        ("Balance ", "label"), ("¥42.17", "strong"),
        ("   ·   bonus ", "label"), ("¥5.00", "strong"),
        ("   ·   2 min ago", "label"),
    ]

    probe_regular = font(15)
    total = 0
    widths = []
    for text, _style in parts:
        width = d.textlength(text, font=probe_regular)
        widths.append(width)
        total += width

    cursor = (W - total) / 2
    y = strip_top + (HALF - 7 - strip_top) / 2 + 1
    for (text, style), width in zip(parts, widths):
        d.text((cursor, y), text, font=font(15, style == "strong"),
               fill=palette[style], anchor="lm")
        cursor += width

    img.save(path)
    return img


dark = render_half(DARK, "DeepSeek Harness · shell.bottom slot · dark theme", "dark.png")
light = render_half(LIGHT, "DeepSeek Harness · shell.bottom slot · light theme", "light.png")

canvas = Image.new("RGB", (W, HALF * 2))
canvas.paste(dark, (0, 0))
canvas.paste(light, (0, HALF))
canvas.save("docs/preview.png")
print("saved docs/preview.png", canvas.size)
