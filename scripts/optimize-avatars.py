#!/usr/bin/env python3
"""Encode official PNG portraits (assets/avatars/) to WebP for the game (public/avatars/).

The PNG originals stay in assets/ as the downloaded source of record; only the
WebP files are deployed. Requires `cwebp` (libwebp). Re-run after fetch-talents.py.
"""
import json, shutil, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'assets' / 'avatars'
TARGET = ROOT / 'public' / 'avatars'
# q86 + sharp YUV keeps hair/eye edges clean at ~15% of the PNG size.
ARGS = ['-quiet', '-q', '86', '-m', '6', '-sharp_yuv', '-alpha_q', '100', '-metadata', 'none']

if not shutil.which('cwebp'):
    sys.exit('cwebp not found: install libwebp (e.g. `apt install webp`)')
TARGET.mkdir(parents=True, exist_ok=True)
before = after = 0
for png in sorted(SOURCE.glob('*.png')):
    webp = TARGET / (png.stem + '.webp')
    subprocess.run(['cwebp', *ARGS, str(png), '-o', str(webp)], check=True)
    before += png.stat().st_size
    after += webp.stat().st_size
# Point talent data at the encoded files.
talents_path = ROOT / 'src' / 'talents.json'
groups = json.loads(talents_path.read_text())
for group in groups:
    for member in group['members']:
        member['image'] = '/avatars/' + member['id'] + '.webp'
talents_path.write_text(json.dumps(groups, ensure_ascii=False, indent=2) + '\n')
print(f'{before / 1e6:.2f} MB PNG -> {after / 1e6:.2f} MB WebP')
