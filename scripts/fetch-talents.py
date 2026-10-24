"""Refresh Japanese talent portraits from the official hololive talent directory."""
import concurrent.futures, json, re, urllib.request
from pathlib import Path
BASE = 'https://hololive.hololivepro.com'
GROUPS = [('asobi-mawari-tai','アソビ★まわり隊！','2026'),('flow-glow','FLOW GLOW','2024'),('regloss','ReGLOSS','2023'),('holox','秘密結社 holoX','2021'),('gen-5','5 期生','2020'),('gen-4','4 期生','2019'),('gen-3','3 期生','2019'),('gamers','GAMERS','2018'),('gen-2','2 期生','2018'),('1stgen','1 期生','2018'),('gen-0','0 期生','2017–2019')]
ROOT = Path(__file__).resolve().parent.parent

def read(url):
    with urllib.request.urlopen(url, timeout=45) as r: return r.read()

def group(entry):
    slug, name, year = entry
    s = read(BASE+'/talents/?gp='+slug).decode()
    section = s.split('<ul class="talent_list clearfix">')[1].split('</ul>')[0]
    talents=[]
    for item in re.findall(r'<li>(.*?)</li>',section,re.S):
        link=re.search(r'href="(/talents/([^/]+)/)"',item)
        img=re.search(r'<img[^>]*src="([^"]+)"',item)
        names=re.search(r'<h3>\s*(.*?)<span>(.*?)</span>',item,re.S)
        if not all([link,img,names]): continue
        jp=re.sub('<[^>]*>','',names[1]).strip()
        if '卒業' in jp or '活動終了' in jp: continue
        talent_id=link[2]; source=BASE+img[1] if img[1].startswith('/') else img[1]
        target=ROOT/'public'/'avatars'/(talent_id+'.png')
        if not target.exists(): target.write_bytes(read(source))
        talents.append(dict(id=talent_id,name=jp,en=names[2].strip(),image='/avatars/'+talent_id+'.png',source=source,url=BASE+link[1]))
    if not talents: raise ValueError('No talents in '+slug)
    print(name, len(talents), flush=True)
    return dict(id=slug,name=name,year=year,members=talents)

with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool: groups=list(pool.map(group,GROUPS))
(ROOT/'src'/'talents.json').write_text(json.dumps(groups,ensure_ascii=False,indent=2)+'\n')
print('Saved',len({m['id'] for g in groups for m in g['members']}),'unique portraits across',len(groups),'groups.')
