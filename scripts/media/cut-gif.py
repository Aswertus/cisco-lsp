#!/usr/bin/env python3
"""Turn a raw ScreenToGif recording of the demo workspace into a store-page GIF.

What it does (the same treatment every store GIF has had since v0.6):
  * crops to the editor: drops the window title bar and the activity bar, so no
    account picture, host name or other extension icons end up in the image;
  * paints over the "ghost" I-beam cursors ScreenToGif leaves in the frame;
  * caps every pause so typing looks snappy, holds the first frame briefly and
    the last frame (the final hover box) for a few seconds, drops everything
    after --last (cursor wandering off after the demo);
  * re-encodes with one global palette so only changed regions are stored
    (about a quarter of the raw size) and without any comment/XMP metadata,
    which the public audit would reject.

Needs Pillow (`pip install pillow`). Usage:

  scripts/media/cut-gif.py _dummy/hero.gif media/hero.gif --last 103

Find --first/--last with --list, which prints every frame's start time; pick the last
frame that still shows what the GIF should end on. Check the result with the
contact sheet (--sheet out.png) before committing: look at it.
"""
import argparse
from PIL import Image, ImageChops, ImageDraw, ImageSequence

p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
p.add_argument('src'); p.add_argument('out', nargs='?')
p.add_argument('--list', action='store_true', help='print frame index @ start time / duration and exit')
p.add_argument('--first', type=int, default=0, help='first frame to keep (drop idle mouse movement before the demo starts)')
p.add_argument('--last', type=int, help='last frame to keep (default: all)')
p.add_argument('--crop', default='58,36,962,1034', help='editor box left,top,right,bottom in the raw frame (default: 1280x800-ish VS Code window with activity bar)')
p.add_argument('--ghost', default='735,670,880,730', help='box of blank editor background where ScreenToGif leaves ghost cursors; painted with frame 0 content. "none" to skip')
p.add_argument('--cap', type=int, default=250, help='max ms per frame (pauses)')
p.add_argument('--start-hold', type=int, default=800, help='ms to hold the first still frame')
p.add_argument('--end-hold', type=int, default=3500, help='ms to hold the last frame')
p.add_argument('--sheet', help='also write a contact sheet PNG of every 6th frame')
a = p.parse_args()

frames = [(f.convert('RGB'), f.info.get('duration', 70)) for f in ImageSequence.Iterator(Image.open(a.src))]
if a.list:
    t = 0
    for i, (_, d) in enumerate(frames):
        print(f'{i}@{t/1000:.1f}s/{d}ms'); t += d
    raise SystemExit
if not a.out:
    p.error('out is required unless --list')

last = a.last if a.last is not None else len(frames) - 1
crop = tuple(int(x) for x in a.crop.split(','))
ghost = None if a.ghost == 'none' else tuple(int(x) for x in a.ghost.split(','))
bg = frames[0][0].crop(ghost) if ghost else None

kept = []
for i, (fr, d) in enumerate(frames[a.first : last + 1]):
    if ghost and ImageChops.difference(fr.crop(ghost), bg).getbbox():
        fr = fr.copy(); fr.paste(bg, ghost[:2])
    kept.append((fr.crop(crop), min(d, a.cap)))
# identical consecutive frames collapse into one; first and last frame get their holds
merged = []
for fr, d in kept:
    if merged and ImageChops.difference(merged[-1][0], fr).getbbox() is None:
        merged[-1] = (merged[-1][0], max(merged[-1][1], d))
    else:
        merged.append((fr, d))
merged[0] = (merged[0][0], a.start_hold)
merged[-1] = (merged[-1][0], a.end_hold)

key = [merged[0][0], merged[len(merged) // 2][0], merged[-1][0]]
strip = Image.new('RGB', (key[0].width, sum(k.height for k in key)))
y = 0
for k in key: strip.paste(k, (0, y)); y += k.height
palette = strip.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
pal = [fr.quantize(palette=palette, dither=Image.Dither.NONE) for fr, _ in merged]
pal[0].save(a.out, save_all=True, append_images=pal[1:], duration=[d for _, d in merged], loop=0, optimize=True, disposal=1)
total = sum(d for _, d in merged) / 1000
print(f'{a.out}: {len(merged)} frames, {total:.1f} s, {merged[0][0].size[0]}x{merged[0][0].size[1]}')

if a.sheet:
    idx = list(range(0, len(merged), 6)); cols = 6; w, h = merged[0][0].size; s = 0.33
    tw, th = int(w * s), int(h * s); rows = (len(idx) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * tw, rows * (th + 16)), 'white'); dr = ImageDraw.Draw(sheet); t = 0
    starts = []
    for _, d in merged: starts.append(t); t += d
    for k, i in enumerate(idx):
        x, y = (k % cols) * tw, (k // cols) * (th + 16)
        sheet.paste(merged[i][0].resize((tw, th)), (x, y + 16)); dr.text((x + 3, y + 2), f'#{i} {starts[i]/1000:.1f}s', fill='black')
    sheet.save(a.sheet); print(f'{a.sheet}: contact sheet, {len(idx)} frames')
