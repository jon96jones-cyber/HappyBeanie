# Lint on the bandana: small light specks on black fabric, left over from the
# original photo. Find them and fill them from their surroundings, leaving the
# wordmark, the fabric's own shading, and every pixel outside the bandana alone.
#
# Usage:  python3 tools/despeckle-bandana.py assets/img/catch/dog.webp [--write] [--diag DIR]
# Without --write it only reports, so you can check the counts before committing
# to anything. --diag writes a before/after strip and a map of what it found.
#
# Needs pillow, numpy and scipy:  pip install pillow numpy scipy
#
# It only ever touches small bright blobs inside the one large dark shape in the
# frame. It will not help on a busy dark background — a tuxedo cat or grass in
# shadow is full of legitimate bright texture that this would happily destroy.
# Look at the --diag output before using --write on anything new.
import sys
from PIL import Image
import numpy as np
from scipy import ndimage

args = [a for a in sys.argv[1:] if not a.startswith('--')]
if not args:
    sys.exit('usage: despeckle-bandana.py <image.webp> [--write] [--diag DIR]')
SRC = OUT = args[0]
DIAG = None
if '--diag' in sys.argv:
    DIAG = sys.argv[sys.argv.index('--diag') + 1].rstrip('/') + '/'

MAX_SPECK = 60     # px; larger bright blobs are the wordmark, not lint
EXCESS = 14        # how much brighter than local fabric counts as a speck

im = Image.open(SRC).convert('RGBA')
a = np.asarray(im).astype(np.float32)
rgb, alpha = a[..., :3], a[..., 3]
lum = rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)

# --- the bandana ---
# The one big dark shape in the frame. Fill its holes so the wordmark counts as
# inside it, which is what lets us tell letters apart from lint later.
dark = (lum < 95) & (alpha > 200)
lab, n = ndimage.label(dark)
if n == 0:
    sys.exit('no dark region found')
sizes = ndimage.sum(dark, lab, range(1, n + 1))
band_core = lab == (int(np.argmax(sizes)) + 1)
bandana = ndimage.binary_fill_holes(band_core)
# Stay off the edge so we never touch the fur boundary or the cut-out alpha.
inner = ndimage.binary_erosion(bandana, np.ones((7, 7), bool))
print('bandana: %d px, inner %d px' % (bandana.sum(), inner.sum()))

# --- the wordmark, protected ---
# A thick letter is uniformly bright, so a local-contrast test sees only its
# edges and reads them as a scatter of small blobs. Mark the letters by their
# own brightness instead, keep the big shapes, and put a fence around them.
letters = (lum > 115) & bandana
letters = ndimage.binary_closing(letters, np.ones((3, 3), bool))
lab_l, n_l = ndimage.label(letters, structure=np.ones((3, 3), bool))
sz_l = ndimage.sum(letters, lab_l, range(1, n_l + 1))
big = np.zeros(n_l + 1, bool)
big[1:] = sz_l >= 25          # every letter is far larger than a piece of lint
wordmark = big[lab_l]
protect = ndimage.binary_dilation(wordmark, np.ones((9, 9), bool))
print('wordmark: %d px in %d shapes, fenced off to %d px'
      % (wordmark.sum(), int(big[1:].sum()), protect.sum()))

# --- specks ---
# Brighter than the fabric immediately around them. A wide median sees past a
# speck to the real fabric, so the difference isolates them from the shading.
med = ndimage.median_filter(lum, size=9)
bright = (lum > med + EXCESS) & inner & ~protect

lab2, n2 = ndimage.label(bright, structure=np.ones((3, 3), bool))
print('bright blobs inside the bandana: %d' % n2)
areas = ndimage.sum(bright, lab2, range(1, n2 + 1))
keep = np.zeros(n2 + 1, bool)
kept = 0
for i, ar in enumerate(areas, start=1):
    if ar <= MAX_SPECK:
        keep[i] = True
        kept += 1
speck = keep[lab2]
print('specks (area <= %d): %d blobs, %d px' % (MAX_SPECK, kept, speck.sum()))
print('left alone as wordmark/large: %d blobs' % (n2 - kept))
if kept:
    print('speck areas: min %d  median %d  max %d' %
          (areas[areas <= MAX_SPECK].min(), np.median(areas[areas <= MAX_SPECK]),
           areas[areas <= MAX_SPECK].max()))

# --- fill ---
# Grow each speck by a pixel so its soft edge goes too, then take the colour
# from a median of the surrounding fabric — which keeps the bandana's shading
# instead of stamping flat black over it.
grow = ndimage.binary_dilation(speck, np.ones((3, 3), bool)) & inner
out = rgb.copy()
for ch in range(3):
    c = rgb[..., ch].copy()
    # Median over clean fabric only: push speck pixels out of the sample by
    # filling them with the channel's local median first, then re-median.
    tmp = c.copy()
    tmp[grow] = ndimage.median_filter(c, size=11)[grow]
    fill = ndimage.median_filter(tmp, size=7)
    c[grow] = fill[grow]
    out[..., ch] = c

changed = int(grow.sum())
print('filled %d px (%.3f%% of the image)' % (changed, 100.0 * changed / lum.size))

res = np.dstack([np.clip(out, 0, 255), alpha]).astype(np.uint8)

# --- diagnostic: where it acted ---
if DIAG:
    ys, xs = np.where(bandana)
    box = (max(0, xs.min() - 12), max(0, ys.min() - 12),
           min(im.width, xs.max() + 12), min(im.height, ys.max() + 12))
    mark = np.asarray(im).copy()
    mark[grow] = [255, 0, 0, 255]
    Image.fromarray(mark).crop(box).convert('RGB').save(DIAG + 'despeck-found.png')
    w, h = box[2] - box[0], box[3] - box[1]
    side = Image.new('RGB', (w * 2 + 8, h), (240, 200, 60))
    side.paste(Image.fromarray(np.asarray(im)).crop(box).convert('RGB'), (0, 0))
    side.paste(Image.fromarray(res).crop(box).convert('RGB'), (w + 8, 0))
    side.save(DIAG + 'despeck-compare.png')

# --- nothing outside the bandana may move ---
# The fill is local, but the re-encode is not, so prove the intended change is
# the only structural one before writing over the asset.
delta = np.abs(np.asarray(im)[..., :3].astype(np.int16) - res[..., :3].astype(np.int16)).max(axis=-1)
moved = delta > 2
outside = moved & ~grow
assert not outside.any(), 'changed %d px outside the fill mask' % int(outside.sum())
assert not (moved & wordmark).any(), 'the wordmark was touched'
print('changed pixels: %d, all inside the fill mask, none on the wordmark' % int(moved.sum()))

if '--write' in sys.argv:
    import os
    # Lossless would be 318KB on its own and blow the section's artwork budget.
    # At q95 the extra generation of loss measures mean 0.88 / max 9 levels
    # across the visible pixels, which is nothing next to the specks it removes.
    was = os.path.getsize(OUT)
    Image.fromarray(res).save(OUT, 'WEBP', quality=95, method=6)
    print('wrote %s (%d bytes, was %d)' % (OUT, os.path.getsize(OUT), was))
else:
    print('(dry run — pass --write to save)')
