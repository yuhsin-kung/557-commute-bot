# /// script
# requires-python = ">=3.11"
# dependencies = ["openpyxl"]
# ///
"""557 監測（含車上人數）：記錄每班 557 從天文館發車、沿途每站、士林國中、捷運士林站、東吳大學的時間，
以及到／離士林國中、捷運士林站時的車上人數（綠舒適／黃中等／紅擁擠）；
回程記東吳停靠、錢穆故居→捷運士林站每站時間，和離開東吳時的人數。輸出成 Excel。

改自 557公車監測/bus557_monitor.py（只記到離站），這版多記網站的「車上人數／擁擠程度」。

用法（在 repo 根目錄）：
    uv run tools/557監測.py                       # 等到下一個 07:00，跑到 19:00
    uv run tools/557監測.py --date 2026-11-25     # 指定日期
    uv run tools/557監測.py --now --minutes 10    # 立刻開始，跑 10 分鐘（測試用）
    uv run tools/557監測.py --rebuild 2026-11-25  # 只用原始紀錄重新產生 Excel

輸出在 data/557監測/：
    557_raw_日期.csv    到離站（A2），格式跟舊版一樣
    557_人數_日期.csv   車上人數（A3）
    557_預估_日期.csv   網站自己的到站預估（士林國中、捷運士林站、錢穆故居）
    557監測_日期.xlsx   整理好的表

資料來源：臺北市公車動態 https://pda5284.gov.taipei/MQS/RouteDyna?routeid=17333
A2：[2]車輛ID [6]去返程(0去/1返) [7]站牌ID [8]事件(0離站/1進站) [9]時間HHMMSS [11]yymmddHHMMSS
A3：[2]車輛ID [4]站牌ID [5]車上人數 [6]擁擠等級(1舒適/2中等/3擁擠，0=沒給) [7]yymmddHHMMSS

【人數怎麼解讀】2026/11/24 16:32–16:47 連續 45 次實測（每 20 秒一次）：
車在每一站會回報兩次人數，都標成那一站的代號——
  - 進站後 1–15 秒回報一次 = 開進這一站時車上的人數（還沒有人上下車）
  - 離站後約 20 秒（58 次裡 41 次在 15–34 秒）再回報一次 = 離開這一站時車上的人數（上下車之後）
例如往捷運站的 EAA-057 開進捷運士林站時 72 人、離開時 48 人（24 人在捷運站下車）。
所以士林站「到站時人數」是直接量到的，不用假設；但只看得到「上車 − 下車」的淨值，
分不出幾個人上、幾個人下（例如士林高商學生在士林站下車，會讓淨值變小）。
人數 0 是真的 0（剛從天文館發車的車），不是沒資料。
網站沒公開人數是怎麼算的（感應器或刷卡），準不準要用現場觀察核對。
"""
import argparse
import csv
import json
import os
import signal
import ssl
import sys
import time
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

URL = "https://pda5284.gov.taipei/MQS/RouteDyna?routeid=17333"
START = "212023"    # 天文科學館（去程起點）
NEXT = "212024"     # 國立科教館（天文館下一站，約 10 秒車程）
JHS = "171188"      # 士林國中（去程）
MRT = "171189"      # 捷運士林站(中正)（去程）
SCHOOL = "171196"   # 東吳大學（去程終點）
BEFORE_JHS = [START, NEXT, "171175", "187538"]  # 天文科學館 → 國立科教館 → 士林高商 → 士林區行政中心
ROUTE = BEFORE_JHS + [JHS, MRT, "171190", "171191", "171192", "171193", "171194", "171195", SCHOOL]
STOP_NAMES = {
    START: "天文科學館", "212024": "國立科教館", "171175": "士林高商", "187538": "士林區行政中心",
    JHS: "士林國中", MRT: "捷運士林站", "171190": "福林國小", "171191": "士林官邸", "171192": "泰北中學",
    "171193": "雙溪公園", "171194": "梅林新村", "171195": "東吳大學(錢穆故居)", SCHOOL: "東吳大學",
}
# 回程站名（站牌代號跟去程不同）
STOP_NAMES.update({"171164": "東吳大學(錢穆故居)", "171165": "梅林新村", "171166": "雙溪公園", "171167": "泰北中學",
                   "171168": "士林官邸", "171169": "福林國小", "171170": "捷運士林站", "171171": "士林國中",
                   "171172": "士林區行政中心", "199583": "士林高商", "199584": "國立科教館", "199585": "天文科學館"})
SHORT = {START: "天文館", "212024": "科教館", "171175": "士林高商", "187538": "行政中心",
         JHS: "士林國中", MRT: "士林站", SCHOOL: "東吳"}
LEVEL_NAMES = {1: "舒適", 2: "中等", 3: "擁擠"}
CAPACITY = 70           # 557 公車設定最多載 70 人
# 【網站人數會高估】網站人數看起來是「上車刷卡 − 下車刷卡」，定期票下車可以不刷，
# 這些人下車了人數也不會減。2026/11/24 實測：
#   - 回程開到終點天文館（全部人都下車了）網站還顯示 9–45 人 → 這些就是沒刷卡下車的人
#   - 每趟去程從天文館發車後人數會歸零（科教館都是 0）
#   - 但在東吳不會歸零：去程沒刷卡的人會帶到回程（EAA-075 東吳 39 → 回程 81）
# 所以某一站的實際人數 = 網站人數 − 到那時為止沒刷卡下車的人，介在
#   網站人數 − 這趟終點還顯示的人數（最少）～ 網站人數 − 這趟出發時已經顯示的人數（最多）
# 去程出發時是 0；回程出發時是去程終點東吳還顯示的人數。
POLL_SECONDS = 15
TAIL_MINUTES = 30        # 結束時間後再追一下，等最後幾班開到東吳
EXCEL_EVERY_SECONDS = 60
A3_WINDOW = timedelta(minutes=3)    # 離站後幾分鐘內回報的人數才算「離開這一站」的
A3_EARLY = timedelta(seconds=10)    # 進站紀錄可能比人數回報晚幾秒
A3_SPLIT = timedelta(seconds=5)     # 離站後 5 秒內的回報當成還在站上（進站那次）
# 在東吳（校內）的回報分兩種，都標成東吳站：剛到站 40–70 秒內那次＝去程剩下的人；
# 之後停 6–9 分鐘讓學生上車，開走前那次已經包含放學上車的人（EAA-066：到站 6 人 → 開走前 65 人）。
# 所以抓「剛到東吳時的人數」只看到站後 90 秒內
SCHOOL_ARRIVE_WINDOW = timedelta(seconds=90)
TRIP_GAP = timedelta(minutes=30)    # 同一台車去程中隔這麼久沒有新紀錄，就當成下一趟
VISIT_LIMIT = timedelta(minutes=20) # 開進東吳大學後 20 分鐘內出現的回程才算同一趟（平常停 6–9 分鐘）
SLOT_MINUTES = 10       # Excel 的「每 N 分鐘」分頁；三天資料每格約 4 班，可用 --slot 改
FEW_TRIPS = 3           # 一格少於這麼多班就塗灰、提醒參考就好

RAW_FIELDS = ["事件時間", "車牌", "車輛ID", "去返程", "站牌ID", "事件", "抓取時間"]
# (存在哪個欄位, Excel 欄名開頭)：每班車記這四個人數
CROWD_POINTS = [("國中到站人數", "到士林國中時"), ("國中人數", "離開士林國中"),
                ("士林站到站人數", "到士林站時"), ("士林站人數", "離開士林站")]
CROWD_FIELDS = ["回報時間", "車牌", "車輛ID", "站牌ID", "車上人數", "擁擠等級", "抓取時間"]
_SEQ = BEFORE_JHS + [JHS, MRT, SCHOOL]
TIME_COLS = ["天文館發車"] + [SHORT[s] + "到站" for s in _SEQ[1:]]
GAP_COLS = [f"{SHORT[a]}→{SHORT[b]}(分)" for a, b in zip(_SEQ, _SEQ[1:])]
TRIP_HEAD = (["編號", "車牌"] + TIME_COLS + GAP_COLS + ["天文館→東吳總計(分)",
             "到士林國中時人數", "到士林國中時擁擠", "離開士林國中人數", "離開士林國中擁擠",
             "到士林站時人數", "到士林站時擁擠", "離開士林站人數", "離開士林站擁擠",
             "士林國中淨上車(人)", "士林站淨上車(人)",
             "終點東吳還顯示(人，沒刷卡下車)", "到士林站時實際約(人)", f"士林站剩幾個位置(以{CAPACITY}人算)",
             "跟前一班到士林站間隔(分)", "備註"])

# ---- 回程（東吳 → 捷運士林站 → 天文館）----
# 車開到去程終點「東吳大學」（校內）後會停 6–9 分鐘讓人上車，這段時間網站不回報人數，
# 接著以回程出現在「東吳大學(錢穆故居)」。所以在錢穆故居第一次回報的人數＝校內＋（可能）錢穆故居上車的人，分不開。
R_QIAN = "171164"   # 東吳大學(錢穆故居)（回程第一站）
R_MRT = "171170"    # 捷運士林站(中正)（回程）
R_BEFORE_MRT = [R_QIAN, "171165", "171166", "171167", "171168", "171169"]  # 錢穆故居 → … → 福林國小
R_ROUTE = R_BEFORE_MRT + [R_MRT, "171171", "171172", "199583", "199584", "199585"]
R_NAMES = {R_QIAN: "東吳大學(錢穆故居)", "171165": "梅林新村", "171166": "雙溪公園", "171167": "泰北中學",
           "171168": "士林官邸", "171169": "福林國小", R_MRT: "捷運士林站", "171171": "士林國中",
           "171172": "士林區行政中心", "199583": "士林高商", "199584": "國立科教館", "199585": "天文科學館"}
R_SHORT = {R_QIAN: "錢穆故居", "171165": "梅林", "171166": "雙溪", "171167": "泰北", "171168": "官邸",
           "171169": "福林", R_MRT: "士林站"}
# 回程只記一個人數：離開東吳時車上幾人（＝校內和錢穆故居都上完車、離開錢穆故居時的人數）
R_CROWD_POINTS = [("東吳人數", "離開東吳")]
R_TIME_COLS = ["到東吳大學(開始停靠)"] + [R_SHORT[x] + "到站" for x in R_BEFORE_MRT + [R_MRT]]
R_GAP_COLS = ["東吳停靠(分)"] + [f"{R_SHORT[a]}→{R_SHORT[b]}(分)" for a, b in zip(R_BEFORE_MRT, R_BEFORE_MRT[1:] + [R_MRT])]
# ---- 網站自己的到站預估（網頁上的「5分」「將到站」）----
# 記這幾站：之後拿來跟實際到站比，看網站準不準，也當我們預測模型要打敗的對象
ETA_STOPS = {JHS: "往東吳｜士林國中", MRT: "往東吳｜捷運士林站", R_QIAN: "往捷運站｜錢穆故居", R_MRT: "往捷運站｜捷運士林站"}
ETA_FIELDS = ["資料時間", "站牌ID", "預估秒數", "車輛ID", "車牌", "抓取時間"]
ETA_BUCKETS = [(0, 3), (3, 6), (6, 10), (10, 15), (15, 99)]   # 依「網站說幾分鐘後到」分組
ETA_MATCH_LATE = timedelta(minutes=30)  # 實際到站最多比預估晚這麼久還算同一班

RETURN_HEAD = (["編號", "車牌"] + R_TIME_COLS + R_GAP_COLS + ["錢穆故居→士林站總計(分)"]
               + [label + k for _, label in R_CROWD_POINTS for k in ("人數", "擁擠")]
               + ["出發前已顯示(人，去程沒刷卡)", "終點天文館還顯示(人)", "離開東吳實際約(人)",
                  f"離開東吳剩幾個位置(以{CAPACITY}人算)", "跟前一班到錢穆故居間隔(分)", "備註"])

SSL_CTX = ssl.create_default_context()
SSL_CTX.verify_flags &= ~getattr(ssl, "VERIFY_X509_STRICT", 0)  # 官方憑證缺 SKI，Python 3.13+ 會擋


def log(msg):
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)


def keep_awake(on):
    """執行期間不讓 Windows 睡眠。"""
    if os.name != "nt":
        return
    import ctypes
    ctypes.windll.kernel32.SetThreadExecutionState(0x80000000 | (0x00000001 if on else 0))


def fetch():
    req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20, context=SSL_CTX) as resp:
        return json.loads(resp.read().decode("utf-8"))


def stamp(s):
    """yymmddHHMMSS → datetime；格式不對回 None"""
    try:
        return datetime.strptime(s, "%y%m%d%H%M%S")
    except (TypeError, ValueError):
        return None


def fmt(t):
    return t.strftime("%Y-%m-%d %H:%M:%S")


def parse(data, fetched_at):
    """一次抓到的資料 → (到離站事件, 人數回報)"""
    events, crowds = [], []
    for bus in data.get("Bus", []):
        num = bus.get("num", "")
        if num.startswith("TEST"):
            continue
        a2 = (bus.get("a2") or "").split(",")
        when = stamp(a2[11]) if len(a2) >= 12 else None
        if when:
            events.append({"事件時間": fmt(when), "車牌": num, "車輛ID": a2[2], "去返程": a2[6],
                           "站牌ID": a2[7], "事件": a2[8], "抓取時間": fmt(fetched_at)})
        a3 = (bus.get("a3") or "").split(",")
        when = stamp(a3[7]) if len(a3) >= 8 else None
        if when and a3[5].lstrip("-").isdigit():
            crowds.append({"回報時間": fmt(when), "車牌": num, "車輛ID": a3[2], "站牌ID": a3[4],
                           "車上人數": a3[5], "擁擠等級": a3[6], "抓取時間": fmt(fetched_at)})
    return events, crowds


def parse_etas(data, fetched_at):
    """一次抓到的資料 → 幾個關鍵站的網站預估（Stop[].n1：[1]站代號 [3]預估的是哪台車 [7]秒數 [11]資料時間）
    秒數是負的代表 -1 未發車、-2 交管不停、-3 末班已過、-4 今日未營運，照樣記"""
    nums = {str(b.get("id")): b.get("num", "") for b in data.get("Bus", [])}
    out = []
    for st in data.get("Stop", []):
        n1 = (st.get("n1") or "").split(",")
        if len(n1) < 12 or n1[1] not in ETA_STOPS or not n1[7].lstrip("-").isdigit():
            continue
        when = stamp(n1[11])
        if when:
            out.append({"資料時間": fmt(when), "站牌ID": n1[1], "預估秒數": n1[7], "車輛ID": n1[3],
                        "車牌": nums.get(n1[3], ""), "抓取時間": fmt(fetched_at)})
    return out


def eta_key(x):
    return (x["站牌ID"], x["資料時間"], x["預估秒數"], x["車輛ID"])


def evaluate_etas(etas, events):
    """每一筆網站預估 → 那台車實際幾點到那一站、差幾分鐘（正的＝比網站說的晚到）"""
    arrivals = defaultdict(list)  # (車輛ID, 站) → [(時間, 事件)]
    for e in events:
        arrivals[(e["車輛ID"], e["站牌ID"])].append((when(e), e["事件"]))
    for v in arrivals.values():
        v.sort()
    out = []
    for x in etas:
        sec = int(x["預估秒數"])
        if sec <= 0:  # 進站中、未發車、交管不停…：沒有可以比的預估
            continue
        base = datetime.strptime(x["資料時間"], "%Y-%m-%d %H:%M:%S")
        predicted = base + timedelta(seconds=sec)
        seen = [(t, k) for t, k in arrivals.get((x["車輛ID"], x["站牌ID"]), []) if base - timedelta(seconds=30) <= t <= predicted + ETA_MATCH_LATE]
        hit = next((t for t, k in seen if k == "1"), None)
        only_left = False
        if hit is None and seen:  # 停很短只抓到離站：用離站時間（晚十幾秒）
            hit, only_left = seen[0][0], True
        out.append({"站": x["站牌ID"], "預估分": sec / 60, "預估到站": predicted, "實際到站": hit,
                    "誤差分": round((hit - predicted).total_seconds() / 60, 2) if hit else None, "只有離站": only_left,
                    "車牌": x["車牌"], "資料時間": base})
    return out


def event_key(e):
    return (e["車輛ID"], e["站牌ID"], e["事件"], e["事件時間"])


def crowd_key(c):
    return (c["車輛ID"], c["站牌ID"], c["回報時間"], c["車上人數"])


def load_csv(path, key):
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8-sig", newline="") as f:
        unique = {}
        for row in csv.DictReader(f):
            unique.setdefault(key(row), row)
    return list(unique.values())


def level_of(c):
    """擁擠等級：網站有給就用；沒給（0）就照網頁程式的換算：>32 擁擠、>22 中等"""
    level = int(c["擁擠等級"] or 0)
    if level > 0:
        return level
    n = int(c["車上人數"])
    return 3 if n > 32 else 2 if n > 22 else 1


def when(e):
    return datetime.strptime(e["事件時間"], "%Y-%m-%d %H:%M:%S")


def split_trips(evs):
    """一台車的事件（照時間排）切成一趟一趟的去程：
    出現返程事件、或隔太久沒動，就是上一趟結束；在天文館（起點）又離站一次，就是新的一趟開始"""
    trips, cur = [], None
    for e in evs:
        if e["去返程"] != "0":
            cur = None
            continue
        restart = e["站牌ID"] == START and cur is not None and any(x["站牌ID"] != START for x in cur)
        if cur is None or restart or when(e) - when(cur[-1]) > TRIP_GAP:
            cur = []
            trips.append(cur)
        cur.append(e)
    return trips


def build_trips(events, crowds, incomplete=None):
    """每台車每一趟去程整理成一列：天文館發車、每站到站時間、士林國中和士林站離站時的人數
    沒有士林站以後紀錄的趟次（GPS 斷線、或還在路上）不列進來；有給 incomplete 就放進去，讓 Excel 另外列出"""
    by_bus = defaultdict(list)
    for e in events:
        by_bus[e["車輛ID"]].append(e)
    crowd_by_bus = defaultdict(list)
    for c in crowds:
        crowd_by_bus[c["車輛ID"]].append(c)

    trips = []
    for vid, evs in by_bus.items():
        evs.sort(key=lambda e: e["事件時間"])
        for seg in split_trips(evs):
            t = {"車牌": seg[0]["車牌"], "車輛ID": vid, "備註": [], "到站": {}, "離站": {}}
            for e in seg:
                if e["事件"] == "1":
                    t["到站"].setdefault(e["站牌ID"], when(e))   # 第一次進站
                else:
                    t["離站"][e["站牌ID"]] = when(e)             # 最後一次離站
            t["發車"] = t["離站"].get(START)
            t["發車用科教館"] = False
            first = seg[0]["站牌ID"]
            if not t["發車"] and first in (START, NEXT):
                # 天文館到科教館只開約 10 秒，每 15 秒抓一次常常漏掉「天文館離站」；跟舊版一樣用科教館的時間
                t["發車"] = t["到站"].get(NEXT) or t["離站"].get(NEXT)
                t["發車用科教館"] = bool(t["發車"])
                if t["發車"]:
                    t["備註"].append("天文館離站沒抓到，發車用國立科教館的時間（兩站約差 10 秒）")
            if not t["發車"]:
                t["備註"].append(f"沒抓到天文館發車（第一筆是{STOP_NAMES.get(first, first)}）")
            # 只有進站沒離站、或只有離站沒進站的站，用有的那個當這站的時間並註記
            # 停站很短（< 15 秒）時常常只抓到離站，就用離站時間（誤差最多十幾秒）；只註記表上有的站
            t["時間"] = {}
            only_left = []
            for stop in ROUTE[1:]:
                if stop in t["到站"]:
                    t["時間"][stop] = t["到站"][stop]
                elif stop in t["離站"]:
                    t["時間"][stop] = t["離站"][stop]
                    if stop in SHORT:
                        only_left.append(SHORT[stop])
            if only_left:
                t["備註"].append("只抓到離站（停站很短），用離站時間：" + "、".join(only_left))
            # 「參考」＝這班到士林站的時間，排序、算間隔、分時段都用它
            i = ROUTE.index(MRT)
            before = [s for s in ROUTE[:i] if s in t["時間"] or s in t["離站"]]
            after = [s for s in ROUTE[i + 1:] if s in t["時間"]]
            why = None
            if MRT in t["時間"]:
                t["參考"] = t["時間"][MRT]
            elif before and after:
                # 士林站前後都有紀錄、只有士林站漏抓：不能不算，不然前後兩班的間隔會被算大
                near = before[-1]
                t["參考"] = t["離站"].get(near) or t["時間"][near]
                t["備註"].append(f"士林站沒抓到，排序和間隔用{STOP_NAMES[near]}離站時間代替（早約 2 分）")
            elif after:
                why = "監測開始時已經開過士林站"
            else:
                why = "之後沒有士林站或更後面的紀錄（GPS 斷線、或還在路上）"
            if why:
                # 不知道幾點到士林站，不能猜，另外列出來
                if incomplete is not None:
                    last = seg[-1]
                    t["最後紀錄"] = (when(last), STOP_NAMES.get(last["站牌ID"], last["站牌ID"]))
                    t["沒列原因"] = why
                    incomplete.append(t)
                continue
            missing = [SHORT[s] for s in BEFORE_JHS[1:] + [JHS, SCHOOL] if s not in t["時間"] and t["發車"]]
            if missing:
                t["備註"].append("沒抓到：" + "、".join(missing))
            mine = crowd_by_bus[vid]
            t["國中到站人數"], t["國中人數"] = crowd_at(mine, JHS, t["到站"].get(JHS), t["離站"].get(JHS))
            t["士林站到站人數"], t["士林站人數"] = crowd_at(mine, MRT, t["到站"].get(MRT), t["離站"].get(MRT))
            # 進站那次網站不一定會回報（停站短時常常沒有）。兩站中間沒有人上下車，
            # 所以「開進這站的人數」＝「離開上一站的人數」，用它補，並註記
            filled = []
            prev_stop = ROUTE[ROUTE.index(JHS) - 1]
            if t["國中到站人數"] is None:
                prev_left = crowd_at(mine, prev_stop, t["到站"].get(prev_stop), t["離站"].get(prev_stop))[1]
                if prev_left:
                    t["國中到站人數"] = prev_left
                    filled.append("到士林國中時＝離開行政中心")
            if t["士林站到站人數"] is None and t["國中人數"]:
                t["士林站到站人數"] = t["國中人數"]
                filled.append("到士林站時＝離開士林國中")
            if filled:
                t["備註"].append("進站人數沒回報，用離開前一站的人數（中間沒人上下車）：" + "、".join(filled))
            # 反過來也一樣：士林站到福林國小只開約 25 秒，離站後 20 秒的那次回報常常已經標成福林國小。
            # 那筆是開進福林國小、還沒離站時回報的 → 等於離開士林站的人數
            filled = []
            if t["國中人數"] is None and t["士林站到站人數"] and t["士林站到站人數"] is not t["國中人數"]:
                t["國中人數"] = t["士林站到站人數"]
                filled.append("離開士林國中＝到士林站時")
            nxt = ROUTE[ROUTE.index(MRT) + 1]
            if t["士林站人數"] is None and (nxt in t["到站"] or nxt in t["離站"]):
                came = crowd_at(mine, nxt, t["到站"].get(nxt), t["離站"].get(nxt))[0]
                if came:
                    t["士林站人數"] = came
                    filled.append(f"離開士林站＝到{STOP_NAMES[nxt]}時")
            if filled:
                t["備註"].append("離站人數沒回報，用開進下一站時的人數（中間沒人上下車）：" + "、".join(filled))
            lacking = [label for key, label in CROWD_POINTS if t[key] is None]
            if lacking:
                t["備註"].append("沒有人數：" + "、".join(lacking))
            # 開到終點東吳時網站還顯示的人數＝這趟沒刷卡下車的人（要在校內有人上車前：用去程錢穆故居離站那次，
            # 沒有才用開進東吳的第一筆）
            t["終點顯示"] = None
            if SCHOOL in t["時間"]:
                arrive = t["時間"][SCHOOL]
                t["終點顯示"] = last_report(mine, {"171195"}, t["參考"], arrive + A3_EARLY)
                if t["終點顯示"] is None:
                    t["終點顯示"] = last_report(mine, {SCHOOL}, arrive - A3_EARLY, arrive + SCHOOL_ARRIVE_WINDOW, first=True)
            came = t["士林站到站人數"] or t["國中人數"]
            t["士林站實際"] = real_range(int(came["車上人數"]) if came else None, 0, t["終點顯示"])
            # 士林國中和士林站中間沒有站：離開國中的人數應該等於開進士林站的人數，不一樣就標出來
            if t["國中人數"] and t["士林站到站人數"] and t["國中人數"]["車上人數"] != t["士林站到站人數"]["車上人數"]:
                t["備註"].append(f"離開士林國中 {t['國中人數']['車上人數']} 人，到士林站時 {t['士林站到站人數']['車上人數']} 人，對不起來")
            trips.append(t)

    trips.sort(key=lambda t: t["參考"])
    prev = None
    for t in trips:
        t["間隔"] = minutes(prev, t["參考"]) if prev else ""
        prev = t["參考"]
    return trips


def build_returns(events, crowds, incomplete=None):
    """每台車每一趟回程整理成一列：到東吳大學開始停靠、錢穆故居→福林國小每站、到捷運士林站，
    以及到／離錢穆故居、士林站的人數"""
    by_bus = defaultdict(list)
    for e in events:
        by_bus[e["車輛ID"]].append(e)
    crowd_by_bus = defaultdict(list)
    for c in crowds:
        crowd_by_bus[c["車輛ID"]].append(c)

    trips = []
    for vid, evs in by_bus.items():
        evs.sort(key=lambda e: e["事件時間"])
        groups, cur, prev = [], None, None
        for e in evs:
            if e["去返程"] == "1":
                if cur is None or prev["去返程"] != "1" or when(e) - when(prev) > TRIP_GAP:
                    cur = {"events": [], "東吳": None}
                    # 這趟回程之前最近一次開進東吳大學（去程終點），20 分鐘內才算同一趟
                    for x in reversed(evs[:evs.index(e)]):
                        if when(e) - when(x) > VISIT_LIMIT:
                            break
                        if x["去返程"] == "0" and x["站牌ID"] == SCHOOL:
                            cur["東吳"] = when(x) if x["事件"] == "1" or cur["東吳"] is None else cur["東吳"]
                            if x["事件"] == "1":
                                break
                    groups.append(cur)
                cur["events"].append(e)
            prev = e
        for g in groups:
            t = {"車牌": g["events"][0]["車牌"], "車輛ID": vid, "備註": [], "到站": {}, "離站": {}, "東吳": g["東吳"]}
            for e in g["events"]:
                if e["事件"] == "1":
                    t["到站"].setdefault(e["站牌ID"], when(e))
                else:
                    t["離站"][e["站牌ID"]] = when(e)
            t["時間"] = {}
            only_left = []
            for stop in R_ROUTE:
                if stop in t["到站"]:
                    t["時間"][stop] = t["到站"][stop]
                elif stop in t["離站"]:
                    t["時間"][stop] = t["離站"][stop]
                    if stop in R_SHORT:
                        only_left.append(R_SHORT[stop])
            if only_left:
                t["備註"].append("只抓到離站（停站很短），用離站時間：" + "、".join(only_left))
            # 「參考」＝開到錢穆故居的時間（≈ 離開校內），排序、算間隔、分時段都用它
            first = g["events"][0]["站牌ID"]
            if R_QIAN in t["時間"]:
                t["參考"] = t["時間"][R_QIAN]
            elif t["東吳"] and first in R_BEFORE_MRT[:2]:
                t["參考"] = t["時間"][first]
                t["備註"].append(f"錢穆故居沒抓到，排序和間隔用{R_NAMES[first]}的時間代替（晚約半分鐘）")
            else:
                if incomplete is not None:
                    last = g["events"][-1]
                    t["最後紀錄"] = (when(last), STOP_NAMES.get(last["站牌ID"], last["站牌ID"]))
                    t["沒列原因"] = f"回程：監測開始時已經離開東吳（第一筆是{R_NAMES.get(first, first)}）"
                    incomplete.append(t)
                continue
            if not t["東吳"]:
                t["備註"].append("沒抓到開進東吳大學（去程終點）")
            missing = [R_SHORT[x] for x in R_BEFORE_MRT[1:] + [R_MRT] if x not in t["時間"]]
            if missing:
                t["備註"].append("沒抓到：" + "、".join(missing))

            # 離開東吳的人數：優先用離開錢穆故居那次回報；沒有就用開進梅林新村時（中間沒人上下車）；
            # 再沒有才用開進錢穆故居時（還沒算到在錢穆故居上車的人，今天實測錢穆故居淨上車都是 0）
            mine = crowd_by_bus[vid]
            came, left = crowd_at(mine, R_QIAN, t["到站"].get(R_QIAN), t["離站"].get(R_QIAN))
            nxt = R_ROUTE[1]
            t["東吳人數"] = left
            if left is None and (nxt in t["到站"] or nxt in t["離站"]):
                t["東吳人數"] = crowd_at(mine, nxt, t["到站"].get(nxt), t["離站"].get(nxt))[0]
                if t["東吳人數"]:
                    t["備註"].append(f"離開東吳人數用開進{R_NAMES[nxt]}時的（中間沒人上下車）")
            if t["東吳人數"] is None and came:
                t["東吳人數"] = came
                t["備註"].append("離開東吳人數用開進錢穆故居時的（沒算到在錢穆故居上車的人）")
            if t["東吳人數"] is None:
                t["備註"].append("沒有人數：離開東吳")
            # 出發前已顯示＝去程開到東吳時還顯示的人數（去程沒刷卡下車，網站在東吳不歸零）
            t["出發顯示"] = None
            if t["東吳"]:
                t["出發顯示"] = last_report(mine, {"171195"}, t["東吳"] - TRIP_GAP, t["東吳"] + A3_EARLY)
                if t["出發顯示"] is None:
                    t["出發顯示"] = last_report(mine, {SCHOOL}, t["東吳"] - A3_EARLY, t["東吳"] + SCHOOL_ARRIVE_WINDOW, first=True)
            # 終點天文館還顯示＝去程＋回程所有沒刷卡下車的人
            t["終點顯示"] = last_report(mine, {"199585"}, t["參考"], t["參考"] + 2 * TRIP_GAP)
            t["東吳實際"] = real_range(int(t["東吳人數"]["車上人數"]) if t["東吳人數"] else None, t["出發顯示"], t["終點顯示"])
            if t["出發顯示"] is not None and t["終點顯示"] is not None and t["終點顯示"] < t["出發顯示"]:
                t["備註"].append(f"終點天文館顯示 {t['終點顯示']} 人比出發前 {t['出發顯示']} 人少，對不起來，沒算實際人數")
            trips.append(t)

    trips.sort(key=lambda t: t["參考"])
    prev = None
    for t in trips:
        t["間隔"] = minutes(prev, t["參考"]) if prev else ""
        prev = t["參考"]
    return trips


def return_row(n, t):
    """一趟回程 → Excel 一列（跟 RETURN_HEAD 對齊）"""
    at = t["時間"]
    count = lambda c: int(c["車上人數"]) if c else ""
    seq = [t["東吳"]] + [at.get(x) for x in R_BEFORE_MRT + [R_MRT]]
    gaps = [minutes(a, b) for a, b in zip(seq, seq[1:])]
    crowd_cells = []
    for key, _ in R_CROWD_POINTS:
        crowd_cells += [count(t[key]), LEVEL_NAMES[level_of(t[key])] if t[key] else ""]
    return ([n, t["車牌"]] + seq + gaps + [minutes(at.get(R_QIAN), at.get(R_MRT))] + crowd_cells
            + [t["出發顯示"] if t["出發顯示"] is not None else "", t["終點顯示"] if t["終點顯示"] is not None else "",
               fmt_range(t["東吳實際"]), seats_left(t["東吳實際"]), t["間隔"], "；".join(t["備註"])])


def last_report(crowds, stops, start, end, first=False):
    """這台車在 start～end 之間、標成這幾站之一的回報，取最後一筆（first=True 取第一筆）的人數"""
    hits = sorted((c for c in crowds if c["站牌ID"] in stops and start <= crowd_time(c) <= end), key=crowd_time)
    if not hits:
        return None
    return int((hits[0] if first else hits[-1])["車上人數"])


def real_range(shown, ghost_start, ghost_end):
    """網站人數 → 實際人數的範圍（扣掉沒刷卡下車的人）；資料不夠或對不起來就回傳 None"""
    if shown is None or ghost_start is None or ghost_end is None or ghost_end < ghost_start:
        return None
    return max(0, shown - ghost_end), max(0, shown - ghost_start)


def fmt_range(r):
    if r is None:
        return ""
    return str(r[0]) if r[0] == r[1] else f"{r[0]}–{r[1]}"


def seats_left(r):
    """以 70 人算還剩幾個位置；超過 70 人寫「超載」"""
    if r is None:
        return ""
    lo, hi = CAPACITY - r[1], CAPACITY - r[0]
    if hi < 0:
        return f"超載 {-hi} 人" if lo == hi else f"超載 {-hi}–{-lo} 人"
    if lo < 0:
        return f"0–{hi}（可能超載）"
    return str(lo) if lo == hi else f"{lo}–{hi}"


def crowd_time(c):
    return datetime.strptime(c["回報時間"], "%Y-%m-%d %H:%M:%S")


def crowd_at(crowds, stop, arrived, left):
    """這台車在這一站的 (進站時人數, 離站後人數)，沒有就是 None
    進站那次：進站前後、離站前 → 取最早一筆；離站那次：離站 5 秒後～3 分鐘內 → 取最後一筆"""
    here = sorted((c for c in crowds if c["站牌ID"] == stop), key=crowd_time)
    if not arrived and not left:
        return None, None
    if left:
        split = left + A3_SPLIT
        start = arrived - A3_EARLY if arrived else left - A3_WINDOW
        before = [c for c in here if start <= crowd_time(c) < split]
        after = [c for c in here if split <= crowd_time(c) <= left + A3_WINDOW]
        return (before[0] if before else None), (after[-1] if after else None)
    # 只抓到進站、沒抓到離站：第一筆當進站時，之後隔 5 秒以上的最後一筆當離站後
    near = [c for c in here if arrived - A3_EARLY <= crowd_time(c) <= arrived + A3_WINDOW + A3_WINDOW]
    if not near:
        return None, None
    later = [c for c in near[1:] if crowd_time(c) - crowd_time(near[0]) > A3_SPLIT]
    return near[0], (later[-1] if later else None)


def minutes(a, b):
    return round((b - a).total_seconds() / 60, 1) if a and b else ""


def autosize(ws, widths):
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w


def trip_row(n, t):
    """一趟車 → Excel 一列（跟 TRIP_HEAD 對齊）"""
    at = t["時間"]
    count = lambda c: int(c["車上人數"]) if c else ""
    crowd_cells = []
    for key, _ in CROWD_POINTS:
        crowd_cells += [count(t[key]), LEVEL_NAMES[level_of(t[key])] if t[key] else ""]
    came = t["士林站到站人數"] or t["國中人數"]  # 到士林站時沒抓到就用離開國中的（兩站中間沒有站）
    seq = [t["發車"]] + [at.get(s) for s in BEFORE_JHS[1:] + [JHS, MRT, SCHOOL]]
    gaps = [minutes(a, b) for a, b in zip(seq, seq[1:])]
    if t["發車用科教館"]:
        gaps[0] = ""  # 發車就是科教館的時間，這段量不到
    return ([n, t["車牌"], t["發車"]] + [at.get(s) for s in BEFORE_JHS[1:]] + [at.get(JHS), at.get(MRT), at.get(SCHOOL)]
            + gaps + [minutes(t["發車"], at.get(SCHOOL))] + crowd_cells
            + [count(t["國中人數"]) - count(t["國中到站人數"]) if t["國中人數"] and t["國中到站人數"] else "",
               count(t["士林站人數"]) - count(came) if came and t["士林站人數"] else "",
               t["終點顯示"] if t["終點顯示"] is not None else "", fmt_range(t["士林站實際"]), seats_left(t["士林站實際"]),
               t["間隔"], "；".join(t["備註"])])


def write_excel(path, trips, events, crowds, day, incomplete=(), returns=(), etas=()):
    wb = Workbook()
    head_font = Font(bold=True, color="FFFFFF")
    head_fill = PatternFill("solid", fgColor="2F5597")
    warn_fill = PatternFill("solid", fgColor="FFF2CC")
    crowd_fill = {1: PatternFill("solid", fgColor="C6EFCE"), 2: PatternFill("solid", fgColor="FFEB9C"),
                  3: PatternFill("solid", fgColor="FFC7CE")}

    def header(ws, cols):
        ws.append(cols)
        for c in ws[ws.max_row]:
            c.font, c.fill, c.alignment = head_font, head_fill, Alignment(horizontal="center", vertical="center", wrap_text=True)
        ws.freeze_panes = f"C{ws.max_row + 1}"  # 用字串：ws.cell() 會多生出一列空白

    ws = wb.active
    ws.title = "每班車"
    header(ws, TRIP_HEAD)
    col = {name: get_column_letter(i) for i, name in enumerate(TRIP_HEAD, start=1)}
    for n, t in enumerate(trips, start=1):
        ws.append(trip_row(n, t))
        r = ws.max_row
        for name in TIME_COLS:
            ws[f"{col[name]}{r}"].number_format = "hh:mm:ss"
        # 人數和擁擠兩格都塗上網站的顏色：綠＝舒適、黃＝中等、紅＝擁擠
        for key, label in CROWD_POINTS:
            if t[key]:
                for name in (label + "人數", label + "擁擠"):
                    ws[f"{col[name]}{r}"].fill = crowd_fill[level_of(t[key])]
        if t["備註"]:
            ws[f"{col['備註']}{r}"].fill = warn_fill
    ws.row_dimensions[1].height = 45
    autosize(ws, [5, 10] + [9] * len(TIME_COLS) + [9] * (len(GAP_COLS) + 1) + [8, 7] * len(CROWD_POINTS) + [9, 9, 12, 12, 12, 9, 45])

    few_fill = PatternFill("solid", fgColor="E7E6E6")

    def mark_few(ws, n):
        """這一格班數太少：整列塗灰、最後一欄寫提醒"""
        if n < FEW_TRIPS:
            ws.cell(row=ws.max_row, column=ws.max_column).value = f"只有 {n} 班，參考就好"
            for c in ws[ws.max_row]:
                c.fill = few_fill

    st = wb.create_sheet(f"每{SLOT_MINUTES}分鐘")
    st.append([f"{day:%Y-%m-%d} 依「到捷運士林站的時間」每 {SLOT_MINUTES} 分鐘分組。"
               "間隔＝這班跟前一班到士林站差幾分鐘；人數是離開士林站時車上的人數"])
    header(st, ["時段", "班次", "平均間隔(分)", "最長間隔(分)", "離開士林站平均人數", "最多人數",
                "擁擠班次", "中等班次", "舒適班次", "沒人數的班次", "天文館→士林國中平均(分)", "士林站→東吳平均(分)", "提醒"])
    slots = defaultdict(list)
    for t in trips:
        ref = t["參考"]
        slots[ref.replace(minute=ref.minute - ref.minute % SLOT_MINUTES, second=0)].append(t)
    avg = lambda xs: round(sum(xs) / len(xs), 1) if xs else ""
    for start in sorted(slots):
        ts = slots[start]
        gaps = [t["間隔"] for t in ts if t["間隔"] != ""]
        counts = [int(t["士林站人數"]["車上人數"]) for t in ts if t["士林站人數"]]
        levels = [level_of(t["士林站人數"]) for t in ts if t["士林站人數"]]
        to_jhs = [minutes(t["發車"], t["時間"].get(JHS)) for t in ts if t["發車"] and JHS in t["時間"]]
        rides = [minutes(t["時間"][MRT], t["時間"][SCHOOL]) for t in ts if MRT in t["時間"] and SCHOOL in t["時間"]]
        st.append([f"{start:%H:%M}–{start + timedelta(minutes=SLOT_MINUTES):%H:%M}", len(ts), avg(gaps),
                   max(gaps) if gaps else "", avg(counts), max(counts) if counts else "",
                   levels.count(3), levels.count(2), levels.count(1), len(ts) - len(counts), avg(to_jhs), avg(rides), ""])
        mark_few(st, len(ts))
    autosize(st, [14, 7, 12, 12, 16, 10, 10, 10, 10, 12, 18, 18, 18])

    rw = wb.create_sheet("回程每班車")
    header(rw, RETURN_HEAD)
    rcol = {name: get_column_letter(i) for i, name in enumerate(RETURN_HEAD, start=1)}
    for n, t in enumerate(returns, start=1):
        rw.append(return_row(n, t))
        r = rw.max_row
        for name in R_TIME_COLS:
            rw[f"{rcol[name]}{r}"].number_format = "hh:mm:ss"
        for key, label in R_CROWD_POINTS:
            if t[key]:
                for name in (label + "人數", label + "擁擠"):
                    rw[f"{rcol[name]}{r}"].fill = crowd_fill[level_of(t[key])]
        if t["備註"]:
            rw[f"{rcol['備註']}{r}"].fill = warn_fill
    rw.row_dimensions[1].height = 45
    autosize(rw, [5, 10] + [9] * len(R_TIME_COLS) + [9] * (len(R_GAP_COLS) + 1) + [8, 7] * len(R_CROWD_POINTS) + [12, 12, 12, 12, 10, 45])

    rs = wb.create_sheet(f"回程每{SLOT_MINUTES}分鐘")
    rs.append([f"{day:%Y-%m-%d} 依「開到錢穆故居的時間」（≈ 離開校內）每 {SLOT_MINUTES} 分鐘分組。"
               "離開東吳人數＝校內和錢穆故居都上完車後車上的人數（網站分不開兩站）"])
    header(rs, ["時段", "班次", "平均間隔(分)", "最長間隔(分)", "離開東吳平均人數", "最多人數",
                "擁擠班次", "中等班次", "舒適班次", "沒人數的班次", "東吳停靠平均(分)", "錢穆故居→士林站平均(分)", "提醒"])
    rslots = defaultdict(list)
    for t in returns:
        ref = t["參考"]
        rslots[ref.replace(minute=ref.minute - ref.minute % SLOT_MINUTES, second=0)].append(t)
    for start in sorted(rslots):
        ts = rslots[start]
        gaps = [t["間隔"] for t in ts if t["間隔"] != ""]
        left = [int(t["東吳人數"]["車上人數"]) for t in ts if t["東吳人數"]]
        levels = [level_of(t["東吳人數"]) for t in ts if t["東吳人數"]]
        stays = [minutes(t["東吳"], t["時間"][R_QIAN]) for t in ts if t["東吳"] and R_QIAN in t["時間"]]
        rides = [minutes(t["時間"][R_QIAN], t["時間"][R_MRT]) for t in ts if R_QIAN in t["時間"] and R_MRT in t["時間"]]
        rs.append([f"{start:%H:%M}–{start + timedelta(minutes=SLOT_MINUTES):%H:%M}", len(ts), avg(gaps),
                   max(gaps) if gaps else "", avg(left), max(left) if left else "",
                   levels.count(3), levels.count(2), levels.count(1), len(ts) - len(left), avg(stays), avg(rides), ""])
        mark_few(rs, len(ts))
    autosize(rs, [14, 7, 12, 12, 16, 10, 10, 10, 10, 12, 14, 18, 18])

    ev_sheet = wb.create_sheet("網站預估準度")
    ev_sheet.append(["網站（網頁上的「5分」「將到站」）每次預估某台車幾分鐘後到站，跟那台車實際到站時間比。"
                     "誤差＝實際 − 預估，正的代表比網站說的晚到。同一台車進站前會被預估很多次（每 15 秒一筆），"
                     "所以筆數不等於班數；依「網站說幾分鐘後到」分組看，越遠的預估通常越不準。"])
    header(ev_sheet, ["站", "網站說幾分鐘後到", "筆數", "對到實際到站", "平均誤差(分)", "平均絕對誤差(分)",
                      "±1 分內(%)", "±3 分內(%)", "最晚多晚到(分)", "最早多早到(分)", "找不到實際到站"])
    scored = evaluate_etas(etas, events)
    for stop, label in ETA_STOPS.items():
        for lo, hi in ETA_BUCKETS:
            group = [x for x in scored if x["站"] == stop and lo <= x["預估分"] < hi]
            if not group:
                continue
            errs = [x["誤差分"] for x in group if x["誤差分"] is not None]
            pct = lambda lim: round(100 * sum(1 for e in errs if abs(e) <= lim) / len(errs)) if errs else ""
            ev_sheet.append([label, f"{lo}–{hi} 分" if hi < 99 else f"{lo} 分以上", len(group), len(errs),
                             round(sum(errs) / len(errs), 1) if errs else "",
                             round(sum(abs(e) for e in errs) / len(errs), 1) if errs else "",
                             pct(1), pct(3), round(max(errs), 1) if errs else "", round(min(errs), 1) if errs else "",
                             len(group) - len(errs)])
    autosize(ev_sheet, [22, 16, 8, 12, 12, 14, 10, 10, 14, 14, 14])

    bad = wb.create_sheet("資料不完整")
    bad.append(["這些趟次時間對不上（GPS 斷線、監測開始時已開過、或結束時還在路上），"
                "所以沒算進「每班車」「回程每班車」和間隔。GPS 斷線多的時段，間隔會被算大。"])
    header(bad, ["車牌", "天文館發車", "最後一筆紀錄時間", "最後一筆在哪一站", "沒列進去的原因", "備註"])
    for t in sorted(incomplete, key=lambda t: t["最後紀錄"][0]):
        bad.append([t["車牌"], t.get("發車"), t["最後紀錄"][0], t["最後紀錄"][1], t["沒列原因"], "；".join(t["備註"])])
        for c in "BC":
            bad[f"{c}{bad.max_row}"].number_format = "hh:mm:ss"
    autosize(bad, [10, 12, 16, 16, 30, 50])

    raw = wb.create_sheet("原始到離站")
    header(raw, RAW_FIELDS + ["站名"])
    for e in sorted(events, key=lambda e: e["事件時間"]):
        raw.append([e[k] for k in RAW_FIELDS] + [STOP_NAMES.get(e["站牌ID"], "")])
    raw2 = wb.create_sheet("原始人數")
    header(raw2, CROWD_FIELDS + ["站名"])
    for c in sorted(crowds, key=lambda c: c["回報時間"]):
        raw2.append([c[k] for k in CROWD_FIELDS] + [STOP_NAMES.get(c["站牌ID"], "")])

    tmp = path + ".tmp.xlsx"
    wb.save(tmp)
    try:
        os.replace(tmp, path)
        return True
    except PermissionError:  # Excel 開著
        os.remove(tmp)
        return False


def in_window(trips, start, end):
    return [t for t in trips if start <= t["參考"] <= end]


def main():
    global SLOT_MINUTES
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", help="監測日期 YYYY-MM-DD（預設：下一個 07:00 所在日）")
    ap.add_argument("--start", default="07:00")
    ap.add_argument("--end", default="19:00")
    ap.add_argument("--now", action="store_true", help="立刻開始")
    ap.add_argument("--minutes", type=int, help="搭配 --now：跑幾分鐘")
    ap.add_argument("--outdir", default=os.path.join(root, "data", "557監測"))
    ap.add_argument("--rebuild", metavar="日期", help="只用這一天的原始紀錄重新產生 Excel")
    ap.add_argument("--slot", type=int, default=SLOT_MINUTES, help="Excel 每幾分鐘一格（預設 10）")
    args = ap.parse_args()
    SLOT_MINUTES = args.slot

    now = datetime.now()
    sh, sm = map(int, args.start.split(":"))
    eh, em = map(int, args.end.split(":"))
    if args.now:
        win_start = now
        win_end = now + timedelta(minutes=args.minutes) if args.minutes else now.replace(hour=eh, minute=em, second=0)
        tail = timedelta(0) if args.minutes else timedelta(minutes=TAIL_MINUTES)
    else:
        if args.date or args.rebuild:
            day = datetime.strptime(args.date or args.rebuild, "%Y-%m-%d")
        else:
            day = now.replace(hour=0, minute=0, second=0, microsecond=0)
            if now >= day.replace(hour=eh, minute=em):
                day += timedelta(days=1)
        win_start = day.replace(hour=sh, minute=sm)
        win_end = day.replace(hour=eh, minute=em)
        tail = timedelta(minutes=TAIL_MINUTES)

    os.makedirs(args.outdir, exist_ok=True)
    day = win_start
    tag = "測試_" if args.minutes else ""
    raw_path = os.path.join(args.outdir, f"557_raw_{tag}{day:%Y-%m-%d}.csv")
    crowd_path = os.path.join(args.outdir, f"557_人數_{tag}{day:%Y-%m-%d}.csv")
    eta_path = os.path.join(args.outdir, f"557_預估_{tag}{day:%Y-%m-%d}.csv")
    xlsx_path = os.path.join(args.outdir, f"557監測_{tag}{day:%Y-%m-%d}.xlsx")

    def save(events, crowds, etas):
        incomplete = []
        trips = in_window(build_trips(events, crowds, incomplete), win_start, win_end)
        returns = in_window(build_returns(events, crowds, incomplete), win_start, win_end)
        incomplete = [t for t in incomplete if win_start <= t["最後紀錄"][0] <= win_end + tail]
        return write_excel(xlsx_path, trips, events, crowds, day, incomplete, returns, etas), trips

    if args.rebuild:
        save(load_csv(raw_path, event_key), load_csv(crowd_path, crowd_key), load_csv(eta_path, eta_key))
        log(f"已產生 {xlsx_path}")
        return

    keep_awake(True)
    log(f"監測時段 {win_start:%Y-%m-%d %H:%M} – {win_end:%H:%M}，輸出到 {args.outdir}")
    while (win_start - datetime.now()).total_seconds() > 0:
        time.sleep(min(60, max(1, (win_start - datetime.now()).total_seconds())))

    # 中途重開會接續
    events, crowds, etas = load_csv(raw_path, event_key), load_csv(crowd_path, crowd_key), load_csv(eta_path, eta_key)
    seen_e, seen_c, seen_t = {event_key(e) for e in events}, {crowd_key(c) for c in crowds}, {eta_key(x) for x in etas}
    files = []
    writers = []
    for path, fields in ((raw_path, RAW_FIELDS), (crowd_path, CROWD_FIELDS), (eta_path, ETA_FIELDS)):
        new = not os.path.exists(path)
        f = open(path, "a", encoding="utf-8-sig", newline="")
        w = csv.DictWriter(f, fieldnames=fields)
        if new:
            w.writeheader()
        files.append(f)
        writers.append(w)

    stopping = []
    signal.signal(signal.SIGINT, lambda *_: stopping.append(True))
    log("監測中……要提早結束請按 Ctrl+C（會先存好 Excel）")
    last_excel, fails, locked = 0, 0, False
    while datetime.now() < win_end + tail and not stopping:
        try:
            data, now = fetch(), datetime.now()
            new_e, new_c = parse(data, now)
            for x in parse_etas(data, now):
                if eta_key(x) not in seen_t:
                    seen_t.add(eta_key(x))
                    etas.append(x)
                    writers[2].writerow(x)
            fails = 0
            for e in new_e:
                if event_key(e) not in seen_e:
                    seen_e.add(event_key(e))
                    events.append(e)
                    writers[0].writerow(e)
            for c in new_c:
                if crowd_key(c) not in seen_c:
                    seen_c.add(crowd_key(c))
                    crowds.append(c)
                    writers[1].writerow(c)
                    if c["站牌ID"] in (JHS, MRT):
                        log(f"{c['車牌']} 在{STOP_NAMES[c['站牌ID']]}回報：{c['車上人數']} 人（{LEVEL_NAMES[level_of(c)]}）")
            for f in files:
                f.flush()
        except Exception as ex:  # 網路暫時失敗就下一輪再試
            fails += 1
            log(f"抓取失敗（第 {fails} 次）：{ex}")
        if time.time() - last_excel > EXCEL_EVERY_SECONDS:
            last_excel = time.time()
            ok, trips = save(events, crowds, etas)
            if ok:
                log(f"Excel 已更新：去程 {len(trips)} 班經過士林站")
                locked = False
            elif not locked:
                log("Excel 開著，先不更新（資料都有記在 CSV）")
                locked = True
        for _ in range(POLL_SECONDS):
            if stopping:
                break
            time.sleep(1)

    for f in files:
        f.close()
    while not save(events, crowds, etas)[0]:
        log(f"請關掉 Excel 裡的 {os.path.basename(xlsx_path)}，關掉後會自動存好……")
        time.sleep(10)
    keep_awake(False)
    log(f"完成！結果在 {xlsx_path}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
