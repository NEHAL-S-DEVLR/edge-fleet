"""
Generates a handful of synthetic warehouse-floor frames so edge_infer.py has
something to run inference on out of the box, with no camera or dataset
required. Swap sample_frames/ for real warehouse camera captures (or point
edge_infer.py at a webcam) for a more convincing judge-facing demo — this
is here purely so `python edge_infer.py` works the moment you clone the repo.

Run: python make_sample_frames.py
"""
import os
import random

from PIL import Image, ImageDraw

OUT_DIR = os.path.join(os.path.dirname(__file__), "sample_frames")
W, H = 640, 480


def draw_shelf(draw, x):
    draw.rectangle([x, 40, x + 60, H - 40], fill=(58, 61, 66), outline=(80, 83, 88))
    for y in range(60, H - 40, 40):
        draw.line([x, y, x + 60, y], fill=(35, 38, 42), width=2)


def draw_person(draw, x, y, scale=1.0):
    # a crude humanoid silhouette — real detectors trained on photos may or
    # may not fire on this; it exists so the pipeline has *something* to
    # look for. Point the script at real camera frames for real detections.
    head_r = int(14 * scale)
    draw.ellipse([x - head_r, y, x + head_r, y + 2 * head_r], fill=(210, 190, 170))
    body_w, body_h = int(26 * scale), int(70 * scale)
    draw.rectangle([x - body_w // 2, y + 2 * head_r, x + body_w // 2, y + 2 * head_r + body_h], fill=(60, 70, 110))


def make_frame(i: int) -> Image.Image:
    img = Image.new("RGB", (W, H), (32, 34, 37))
    draw = ImageDraw.Draw(img)
    # floor grid
    for gx in range(0, W, 40):
        draw.line([gx, 0, gx, H], fill=(40, 43, 47))
    for gy in range(0, H, 40):
        draw.line([0, gy, W, gy], fill=(40, 43, 47))
    # shelving racks
    for x in range(20, W - 100, 160):
        draw_shelf(draw, x)
    # a person in the aisle on some frames, to vary detection load frame to frame
    random.seed(i)
    if i % 2 == 0:
        draw_person(draw, random.randint(100, W - 100), random.randint(H - 220, H - 140))
    # an AMR-like box
    ax, ay = random.randint(60, W - 120), random.randint(H - 100, H - 60)
    draw.rectangle([ax, ay, ax + 46, ay + 30], fill=(255, 130, 72), outline=(20, 16, 8))
    return img


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for i in range(6):
        img = make_frame(i)
        path = os.path.join(OUT_DIR, f"frame_{i:02d}.jpg")
        img.save(path, quality=85)
        print("wrote", path)


if __name__ == "__main__":
    main()
