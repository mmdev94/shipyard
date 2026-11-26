"""Assembles frames from record-media.cjs into GIFs (one shared palette per GIF, no dithering)."""
import sys, os, glob
from PIL import Image

frames_dir, out_dir = sys.argv[1], sys.argv[2]
FPS = 15
HOLD_LAST_MS = 1800

def frames(name):
    return sorted(glob.glob(os.path.join(frames_dir, name, '*.png')))

def gif(names, out, scale=1.0, step=1):
    files = [f for n in names for f in frames(n)[::step]]
    imgs = [Image.open(f).convert('RGB') for f in files]
    if scale != 1.0:
        imgs = [im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS) for im in imgs]
    # one palette for the whole GIF, from a sample of frames
    sample = imgs[:: max(1, len(imgs) // 12)]
    strip = Image.new('RGB', (sample[0].width, sample[0].height * len(sample)))
    for i, im in enumerate(sample):
        strip.paste(im, (0, i * im.height))
    pal = strip.quantize(colors=160, method=Image.Quantize.MEDIANCUT)
    q = [im.quantize(palette=pal, dither=Image.Dither.NONE) for im in imgs]
    durations = [int(1000 / FPS * step)] * len(q)
    durations[-1] = HOLD_LAST_MS
    q[0].save(out, save_all=True, append_images=q[1:], duration=durations, loop=0, optimize=True, disposal=1)
    print(out, f'{os.path.getsize(out) / 1e6:.1f} MB', len(q), 'frames')

os.makedirs(out_dir, exist_ok=True)
for clip in ['check', 'deploy', 'push', 'fix']:
    gif([clip], os.path.join(out_dir, f'shipyard-{clip}.gif'), scale=0.75)
gif(['title', 'check', 'deploy', 'push', 'end'], os.path.join(out_dir, 'shipyard-ad.gif'), scale=0.75, step=1)
