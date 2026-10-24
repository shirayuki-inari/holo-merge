"""Verify dist, then create a static-site ZIP, checksums, and a byte-accurate size manifest."""
import hashlib
import json
from pathlib import Path
import shutil
import zipfile
from html.parser import HTMLParser

ROOT = Path(__file__).resolve().parent.parent
DIST, RELEASE = ROOT / 'dist', ROOT / 'release'
assert (DIST / 'index.html').is_file(), 'Run npm run build first'
assert (DIST / 'assets').is_dir()
files = sorted(path for path in DIST.rglob('*') if path.is_file())
assert not any(path.is_symlink() for path in DIST.rglob('*')), 'Symlinks are not deployable assets'

def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def require_asset(url):
    assert url.startswith('/') and '..' not in url.split('/'), url
    path = DIST / url.lstrip('/')
    assert path.is_file(), 'Missing production asset: ' + url
    return path

class Entrypoints(HTMLParser):
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        url = attrs.get('src') if tag == 'script' else attrs.get('href') if tag == 'link' else None
        if url and url.startswith('/'):
            require_asset(url)
Entrypoints().feed((DIST / 'index.html').read_text())
voices = json.loads((ROOT / 'src/audio/character-voices.json').read_text())
for member in voices.values():
    for event in ('drop', 'merge', 'win'): require_asset(member[event]['src'])
talent_groups = json.loads((ROOT / 'src/talents.json').read_text())
for group in talent_groups:
    for member in group['members']: require_asset(member['image'])
bgm = sorted((DIST / 'audio/bgm').glob('*.mp3'))
assert len(bgm) == 3, 'Package all three BGM files'
voice_files = list((DIST / 'audio/characters').glob('*/*.mp3'))
assert len(voice_files) == len(voices) * 3
allowed_top = {'index.html', 'favicon.svg', 'assets', 'audio', 'avatars'}
assert all(path.relative_to(DIST).parts[0] in allowed_top for path in files), 'Unexpected file in dist'
assert not any(path.suffix.lower() in {'.wav', '.csv', '.ts', '.tsx', '.map'} for path in files)
RELEASE.mkdir(exist_ok=True)
archive = RELEASE / 'holo-merge-web.zip'
temporary = RELEASE / 'holo-merge-web.zip.tmp'
with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as package:
    for path in files:
        # Normalize permissions so a web server can read files extracted from Termux.
        info = zipfile.ZipInfo(path.relative_to(DIST).as_posix(), date_time=(2026, 1, 1, 0, 0, 0))
        info.create_system = 3
        info.external_attr = 0o100644 << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        package.writestr(info, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
with zipfile.ZipFile(temporary) as package:
    assert package.testzip() is None
    assert set(package.namelist()) == {path.relative_to(DIST).as_posix() for path in files}
    for path in files:
        assert hashlib.sha256(package.read(path.relative_to(DIST).as_posix())).hexdigest() == sha256(path)
temporary.replace(archive)

def category(path):
    name = path.relative_to(DIST).as_posix()
    if name.startswith('audio/bgm/'): return 'bgm'
    if name.startswith('audio/characters/'): return 'characterVoices'
    if name.startswith('avatars/'): return 'portraits'
    if path.suffix == '.js': return 'javascript'
    if path.suffix == '.css': return 'styles'
    return 'htmlAndOther'

categories = {}
for path in files:
    entry = categories.setdefault(category(path), dict(files=0, bytes=0))
    entry['files'] += 1
    entry['bytes'] += path.stat().st_size
report = dict(name='holo-merge', version=json.loads((ROOT / 'package.json').read_text())['version'],
              hosting='static site at origin root', entrypoint='index.html',
              fileCount=len(files), unpackedBytes=sum(path.stat().st_size for path in files),
              archive=dict(file=archive.name, bytes=archive.stat().st_size, sha256=sha256(archive)),
              voiceCoverage=dict(members=len(voices), totalMembers=len({member['id'] for group in talent_groups for member in group['members']}), recordings=len(voice_files)),
              categories=categories,
              files=[dict(path=path.relative_to(DIST).as_posix(), bytes=path.stat().st_size, sha256=sha256(path)) for path in files])
manifest = RELEASE / 'deployment-manifest.json'
manifest.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
shutil.copy2(ROOT / 'deploy/nginx.conf', RELEASE / 'nginx.conf')
(RELEASE / 'README.txt').write_text('''holo merge! 静态部署包

1. 校验 SHA256SUMS，解压 holo-merge-web.zip。
2. 将解压出的 index.html、assets/、avatars/、audio/ 和 favicon.svg 放到网站根目录。
3. 使用任意静态托管服务，或参考随附 nginx.conf 配置 Nginx。
   Nginx 示例监听 8080，网站目录为 /usr/share/nginx/html；根据服务器情况修改。
   配置需位于 Nginx 的 http 上下文，并由主配置加载 mime.types。
4. 本游戏不需要后端服务或运行 Node.js。音频需以 audio/mpeg、JS 以 JavaScript MIME 类型提供。
5. 当前包用于域名根路径部署；部署到 /game/ 等子路径前需同步调整资源路径。
6. index.html 使用 no-cache，带哈希的 assets 文件可长期缓存；音频和头像使用短期缓存。
   丢失的音频文件应返回 404，不应回退到 index.html。

源码中的 npm run package 会重新构建、检查资源并生成本目录。
总大小、分类大小和逐文件校验值见 deployment-manifest.json。
Google Fonts 为可选的在线字体，无法访问时使用系统字体，不影响游戏功能。
''')
checksum_files = [archive, manifest, RELEASE / 'nginx.conf', RELEASE / 'README.txt']
(RELEASE / 'SHA256SUMS').write_text(''.join(f'{sha256(path)}  {path.name}\n' for path in checksum_files))
print(json.dumps({key: value for key, value in report.items() if key != 'files'}, ensure_ascii=False, indent=2))
