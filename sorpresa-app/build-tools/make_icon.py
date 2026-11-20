import math, sys
from PIL import Image, ImageDraw
res = sys.argv[1]
sizes = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
S = 768
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.ellipse((24, 24, S - 24, S - 24), fill=(255, 79, 154, 255))
d.ellipse((90, 90, S - 90, S - 90), fill=(255, 214, 229, 255))
pts = []
for i in range(400):
    t = 2 * math.pi * i / 400
    x = 16 * math.sin(t) ** 3
    y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
    pts.append((S / 2 + x * 15, S / 2 - y * 15 + 20))
d.polygon(pts, fill=(233, 30, 99, 255))
for name, px in sizes.items():
    img.resize((px, px), Image.LANCZOS).save(f"{res}/mipmap-{name}/ic_launcher.png")
