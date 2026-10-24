"""Import the manually curated recordings; normal npm builds need no conversion tools."""
import argparse
import concurrent.futures
import csv
import hashlib
import json
import shutil
import subprocess
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EVENTS = ('drop', 'merge', 'win')
EVENT_NAMES = {'drop': '投放', 'merge': '合成', 'win': '最高等级'}
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--csv', type=Path, default=ROOT / 'assets/character-voices/source-index.csv')
parser.add_argument('--wav-dir', type=Path, default=ROOT / '.qa/voice-text/short-audio-job/wav-all')
args = parser.parse_args()

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

with args.csv.open(encoding='utf-8-sig', newline='') as source:
    rows = list(csv.DictReader(source))
choices = json.loads((ROOT / 'assets/character-voices/choices.json').read_text())
groups = json.loads((ROOT / 'src/talents.json').read_text())
talents = {member['id']: member for group in groups for member in group['members']}
by_name = {talent['name']: talent for talent in talents.values()}
lookup = {(r['角色'].split(' ', 1)[0], r['文件路径']): r for r in rows}
assert set(choices) == {r['角色'].split(' ', 1)[0] for r in rows}, 'Curate every supplied character'
jobs = []
for character_id, events in choices.items():
    assert set(events) == set(EVENTS) and len(set(events.values())) == 3
    for event in EVENTS:
        filename = events[event]
        assert Path(filename).name == filename
        row = lookup[(character_id, filename)]
        name = row['角色'].split(' ', 1)[1]
        talent = by_name[name]
        assert 0 < len(row['台词']) <= 10
        copied = ROOT / 'assets/character-voices/wav' / talent['id'] / (event + '.wav')
        candidates = [args.wav_dir / filename,
                      ROOT / '.qa/voice-text/06002-06005-audio-job/wav-all' / filename,
                      copied]
        source = next((path for path in candidates if path.exists()), candidates[0])
        assert source.exists(), str(source)
        with wave.open(str(source)) as wav:
            duration = wav.getnframes() / wav.getframerate()
            assert wav.getsampwidth() == 2 and 0 < duration <= 5
        target = ROOT / 'public/audio/characters' / talent['id'] / (event + '.mp3')
        jobs.append(dict(character_id=character_id, talent=talent, event=event, row=row,
                         source=source, copied=copied, target=target, duration=duration))

def convert(job):
    source, copied, target = (job[key] for key in ('source', 'copied', 'target'))
    copied.parent.mkdir(parents=True, exist_ok=True)
    target.parent.mkdir(parents=True, exist_ok=True)
    if source.resolve() != copied.resolve(): shutil.copy2(source, copied)
    assert digest(source) == digest(copied)
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
                    '-i', str(copied), '-map_metadata', '-1', '-vn', '-ac', '1', '-ar', '48000',
                    '-codec:a', 'libmp3lame', '-q:a', '3', '-threads', '1', str(target)], check=True)
    return job

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    jobs = list(pool.map(convert, jobs))
catalog, selections = {}, []
for job in jobs:
    talent, event, row = job['talent'], job['event'], job['row']
    role = catalog.setdefault(talent['id'], dict(characterId=job['character_id'], name=talent['name']))
    role[event] = dict(text=row['台词'], src='/' + str(job['target'].relative_to(ROOT / 'public')),
                       sourceFile=row['文件路径'], sourceSha256=digest(job['copied']),
                       durationSeconds=round(job['duration'], 6))
    selections.append({'角色ID': job['character_id'], '成员ID': talent['id'], '角色': talent['name'],
                       '阶段': EVENT_NAMES[event], '台词': row['台词'], '原文件': row['文件路径'],
                       '原始WAV': str(job['copied'].relative_to(ROOT)),
                       '游戏音频': str(job['target'].relative_to(ROOT)),
                       '时长（秒）': round(job['duration'], 6)})
source_inputs = [dict(path=str(path.relative_to(ROOT)), sha256=digest(path),
                      rows=sum(1 for _ in csv.DictReader(path.open(encoding='utf-8-sig', newline=''))))
                 for path in sorted((ROOT / 'assets/character-voices').glob('source-[0-9]*.csv'))]
coverage = dict(sourceInputs=source_inputs, sourceCsv='assets/character-voices/source-index.csv', sourceCsvSha256=digest(args.csv),
                sourceRows=len(rows), totalTalents=len(talents), coveredTalents=len(catalog),
                coveragePercent=round(100 * len(catalog) / len(talents), 2),
                selectedClips=len(jobs), events=list(EVENTS),
                originalBytes=sum(job['copied'].stat().st_size for job in jobs),
                playbackBytes=sum(job['target'].stat().st_size for job in jobs),
                missing=[dict(id=talent['id'], name=talent['name'], reason='not_in_provided_csv')
                         for talent in talents.values() if talent['id'] not in catalog],
                groups=[dict(id=group['id'], name=group['name'], total=len(group['members']),
                             covered=sum(member['id'] in catalog for member in group['members']))
                        for group in groups])
(ROOT / 'src/audio/character-voices.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n')
(ROOT / 'assets/character-voices/coverage.json').write_text(json.dumps(coverage, ensure_ascii=False, indent=2) + '\n')
with (ROOT / 'assets/character-voices/selection.csv').open('w', encoding='utf-8-sig', newline='') as target:
    writer = csv.DictWriter(target, fieldnames=list(selections[0]))
    writer.writeheader(); writer.writerows(selections)
print(json.dumps({key: value for key, value in coverage.items() if key not in ('missing', 'groups')}, ensure_ascii=False, indent=2))
