#!/usr/bin/env python3
"""
Stitch a vertically-scrolling video into a single tall image.

Reads frames from <frames-dir>/*.png in lexicographic order.
Assumes the camera pans up (newer content enters from the top of the
viewport over time), which is how the Been timeline export scrolls.

Writes the stitched image to <out-path>.
"""
import sys, glob
from pathlib import Path
import numpy as np
from PIL import Image

def load(path):
    return np.array(Image.open(path).convert("RGB"))

def find_shift(a, b, max_shift=120):
    """Return dy >= 0 such that row r of `a` matches row r+dy of `b`."""
    H, W = a.shape[:2]
    # Sample a vertical strip in the middle that contains text content
    x0, x1 = W // 4, 3 * W // 4
    sa = a[:, x0:x1].astype(np.int32)
    sb = b[:, x0:x1].astype(np.int32)
    best_dy, best_err = 0, None
    for dy in range(max_shift + 1):
        if dy >= H: break
        diff = sa[:H - dy] - sb[dy:]
        err = np.abs(diff).mean()
        if best_err is None or err < best_err:
            best_err, best_dy = err, dy
    return best_dy, best_err

def main():
    if len(sys.argv) != 3:
        print("usage: stitch.py <frames-dir> <out-path>", file=sys.stderr)
        sys.exit(2)
    frames_dir, out_path = sys.argv[1], sys.argv[2]
    paths = sorted(glob.glob(str(Path(frames_dir) / "*.png")))
    if not paths:
        print("no frames", file=sys.stderr); sys.exit(2)

    print(f"loading {len(paths)} frames…", file=sys.stderr)
    imgs = [load(p) for p in paths]
    H, W = imgs[0].shape[:2]

    shifts = [0]
    for i in range(1, len(imgs)):
        dy, err = find_shift(imgs[i - 1], imgs[i])
        shifts.append(dy)
        if i % 100 == 0 or i == len(imgs) - 1:
            print(f"  shift[{i}] = {dy} (err={err:.2f})", file=sys.stderr)

    total_scroll = sum(shifts)
    canvas_h = H + total_scroll
    print(f"canvas: {W}x{canvas_h} (scroll={total_scroll})", file=sys.stderr)

    canvas = np.zeros((canvas_h, W, 3), dtype=np.uint8)
    # Place frame 0 at the bottom; each later frame contributes its top
    # `shifts[i]` rows of new content at progressively higher positions.
    y_top_of_frame_0 = total_scroll
    canvas[y_top_of_frame_0:y_top_of_frame_0 + H] = imgs[0]
    y = y_top_of_frame_0
    for i in range(1, len(imgs)):
        y -= shifts[i]
        new_rows = shifts[i]
        if new_rows > 0:
            canvas[y:y + new_rows] = imgs[i][:new_rows]
    # The final frame's full content takes priority at the top to ensure
    # the newest entry (which may have only just appeared) is captured cleanly.
    canvas[0:H] = imgs[-1]

    Image.fromarray(canvas).save(out_path, optimize=True)
    print(f"wrote {out_path}", file=sys.stderr)

if __name__ == "__main__":
    main()
