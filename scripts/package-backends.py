"""Create dependency-free Node and prebundled Workers deployment options."""
from pathlib import Path
import hashlib
import json
import zipfile
ROOT = Path(__file__).resolve().parent.parent
release = ROOT / 'release'
release.mkdir(exist_ok=True)

def pack(name, files):
    path = release / name
    with zipfile.ZipFile(path, 'w') as archive:
        for name, content in files.items():
            entry = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, content, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    with zipfile.ZipFile(path) as archive:
        assert archive.testzip() is None
    return path
common = {'README.md': (ROOT / 'deploy/leaderboard.md').read_bytes(), 'admin.md': (ROOT / 'deploy/admin.md').read_bytes()}
node = pack('holo-merge-node.zip', dict(common, **{
    'node.mjs': (ROOT / 'server-dist/node.mjs').read_bytes(),
    'leaderboard.env.example': (ROOT / 'deploy/leaderboard.env.example').read_bytes(),
    'nginx-leaderboard.conf': (ROOT / 'deploy/nginx-leaderboard.conf').read_bytes(),
}))
# This config uses the bundled module, so source files/node_modules are unnecessary.
config = json.loads((ROOT / 'wrangler.jsonc').read_text())
config['main'] = 'worker.mjs'
config.pop('$schema', None)
worker = pack('holo-merge-workers.zip', dict(common, **{
    'worker.mjs': (ROOT / 'server-dist/worker.mjs').read_bytes(),
    'wrangler.jsonc': (json.dumps(config, indent=2) + '\n').encode(),
}))
checksums = release / 'SHA256SUMS'
lines = [line for line in checksums.read_text().splitlines() if not any(p.name in line for p in (node, worker))] if checksums.exists() else []
for path in (node, worker):
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    lines.append(f'{digest}  {path.name}')
    print(f'{path.name}: {path.stat().st_size:,} bytes, sha256 {digest}')
checksums.write_text('\n'.join(lines) + '\n')
