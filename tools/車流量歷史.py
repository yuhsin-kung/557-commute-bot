"""
士林站到外雙溪沿線的歷史車流量（TDX 車輛偵測器 VD 歷史資料）

用法（在 repo 根目錄；只用到 Python 內建模組，不用裝套件）：
    python tools/車流量歷史.py 2026-10-13 2026-10-14
    python tools/車流量歷史.py 2026-10-05..2026-10-09

金鑰讀 keys.env 的 TDX_CLIENT_ID、TDX_CLIENT_SECRET。
TDX 的歷史 API 一次給一整天、臺北市全部約 640 支偵測器（一天約 1 GB），不能只挑幾支，
所以這支程式邊下載邊過濾，只留下 VDS 裡的偵測器，整理成每 5 分鐘一列，存到 data/車流量/日期.csv。
歷史資料大約從 2024 年起才有；TDX 有呼叫頻率限制，被擋（429）會等一下再試。

⚠️ 很耗 TDX 點數：一天約 1 GB。2026/10/16 抓了大約兩天份（2.4 GB、約 119 點），
   免費帳號就被「超量使用停權」，連 Bot 的 557 到站也一起不能用。
   所以預設不會執行，要加 --我知道會用掉點數 才會跑，而且一次只准抓一天。
"""
import csv
import json
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / '車流量'
TPE = timezone(timedelta(hours=8))

# 士林站到外雙溪一帶的偵測器（2026/10/16 用 TDX 靜態資料、經緯度圈出來的）
VDS = {
    'VWRLS20': '至善路一段（錢穆故居站附近）',
    'VX9KL60': '福林路',
    'VXWNW20': '至善路二段（故宮側）',
    'VVYIV00': '中山北路五段（士林站南）',
    'VU5IF00': '中山北路五段',
    'VUVHL40': '承德路四段',
    'VV7GX00': '承德路四段',
    'VXSLB20': '仰德大道一段',
    'VXPHL20': '福國路',
    'VF9M500': '北安路',
    'VU9NA40': '北安路',
    'VYBIB00': '中山北路六段',
}
DIRECTION = {'N': '北向', 'S': '南向', 'E': '東向', 'W': '西向', 'NE': '東北向', 'NW': '西北向', 'SE': '東南向', 'SW': '西南向'}
BUCKET_MIN = 5

ctx = ssl.create_default_context()
ctx.verify_flags &= ~ssl.VERIFY_X509_STRICT  # Python 3.13 以後預設比較嚴，TDX 的憑證過不了


def keys():
    env = {}
    for line in (ROOT / 'keys.env').read_text(encoding='utf-8').splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            k, v = line.split('=', 1)
            env[k.strip()] = v.strip()
    return env


def token():
    env = keys()
    data = urllib.parse.urlencode({'grant_type': 'client_credentials', 'client_id': env['TDX_CLIENT_ID'], 'client_secret': env['TDX_CLIENT_SECRET']}).encode()
    req = urllib.request.Request('https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token', data=data)
    return json.load(urllib.request.urlopen(req, context=ctx))['access_token']


def get(api, path):
    url = 'https://tdx.transportdata.tw/api/' + api + path
    for wait in (0, 10, 30, 60, 120):
        time.sleep(wait)
        try:
            req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token(), 'Accept-Encoding': 'identity'})
            return urllib.request.urlopen(req, context=ctx, timeout=120)
        except urllib.error.HTTPError as e:
            if e.code != 429:
                raise
    raise RuntimeError('TDX 一直回 429（呼叫太頻繁），晚點再試')


def directions():
    """每個方向（LinkID）是往哪裡：從偵測器的靜態資料查"""
    data = json.load(get('basic', '/v2/Road/Traffic/VD/City/Taipei?%24format=JSON'))
    found = {}
    for v in data.get('VDs', data):
        if v['VDID'] in VDS:
            for link in v.get('DetectionLinks', []):
                found[link['LinkID']] = DIRECTION.get(link.get('Bearing'), link.get('Bearing') or '')
    return found


def one_day(day, link_dir):
    """下載一天，回傳 {(偵測器, 方向, 5 分鐘的開始時間): [車數, 車速×車數]}"""
    rows = defaultdict(lambda: [0, 0, 0, 0, 0])  # 小車, 大車, 機車, 聯結車, 車速×車數
    kind = {'S': 0, 'L': 1, 'M': 2, 'T': 3}
    with get('historical', '/v2/Historical/Road/Traffic/Live/VD/City/Taipei?Dates=' + day + '&%24format=JSON') as res:
        for raw in res:
            if not any(vd.encode() in raw for vd in VDS):  # 先用字串篩，不用每一行都解析
                continue
            rec = json.loads(raw.decode('utf-8-sig'))
            if rec.get('VDID') not in VDS or rec.get('Status', 0) != 0:
                continue
            t = datetime.fromisoformat(rec['DataCollectTime']).astimezone(TPE)
            t = t.replace(minute=t.minute - t.minute % BUCKET_MIN, second=0)
            if t.date().isoformat() != day:
                continue
            for flow in rec.get('LinkFlows', []):
                cell = rows[(rec['VDID'], link_dir.get(flow['LinkID'], flow['LinkID']), t)]
                for lane in flow.get('Lanes', []):
                    for v in lane.get('Vehicles', []):
                        n = v.get('Volume', 0)
                        if n < 0 or v.get('VehicleType') not in kind:  # 負數是偵測器故障
                            continue
                        cell[kind[v['VehicleType']]] += n
                        cell[4] += n * max(v.get('Speed', 0), 0)
    return rows


def save(day, rows):
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / (day + '.csv')
    with path.open('w', encoding='utf-8-sig', newline='') as f:  # utf-8-sig：Excel 打開才不會亂碼
        w = csv.writer(f)
        w.writerow(['日期', '時間', '偵測器', '路段', '方向', '總車數', '小車', '大車', '機車', '聯結車', '平均車速(km/h)'])
        for (vd, direction, t), c in sorted(rows.items(), key=lambda kv: (kv[0][0], kv[0][1], kv[0][2])):
            total = sum(c[:4])
            w.writerow([day, t.strftime('%H:%M'), vd, VDS[vd], direction, total, c[0], c[1], c[2], c[3], round(c[4] / total, 1) if total else ''])
    return path


def dates(args):
    for a in args:
        if '..' in a:
            start, end = (date.fromisoformat(x) for x in a.split('..'))
            while start <= end:
                yield start.isoformat()
                start += timedelta(days=1)
        else:
            yield date.fromisoformat(a).isoformat()


def main():
    sys.stdout.reconfigure(encoding="utf-8")  # Windows 的終端機預設不是 UTF-8，印中文會出錯
    args = [a for a in sys.argv[1:] if a != '--我知道會用掉點數']
    days = list(dates(args))
    if not days or len(args) == len(sys.argv) - 1:
        print(__doc__)
        return
    if len(days) > 1:
        print('一次只能抓一天（一天約 1 GB，會用掉大量 TDX 點數）')
        return
    link_dir = directions()
    for day in days:
        began = time.time()
        rows = one_day(day, link_dir)
        if not rows:
            print(day, '沒有資料（可能太久以前，或 TDX 還沒整理好）')
            continue
        path = save(day, rows)
        print(day, '完成', len(rows), '列', round(time.time() - began), '秒 →', path.relative_to(ROOT))


if __name__ == '__main__':
    main()
