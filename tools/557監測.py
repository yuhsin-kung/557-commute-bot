# /// script
# requires-python = ">=3.11"
# dependencies = ["openpyxl"]
# ///
"""557 監測（含車上人數）：記錄每班 557 從天文館發車、沿途每站、士林國中、捷運士林站、東吳大學的時間，
以及到／離士林國中、捷運士林站時的車上人數（綠舒適／黃中等／紅擁擠），輸出成 Excel。

改自 557公車監測/bus557_monitor.py（只記到離站），這版多記網站的「車上人數／擁擠程度」。

用法（在 repo 根目錄）：
    uv run tools/557監測.py                       # 等到下一個 07:00，跑到 19:00
    uv run tools/557監測.py --date 2026-11-25     # 指定日期
    uv run tools/557監測.py --now --minutes 10    # 立刻開始，跑 10 分鐘（測試用）
    uv run tools/557監測.py --rebuild 2026-11-25  # 只用原始紀錄重新產生 Excel

輸出在 data/557監測/：
    557_raw_日期.csv    到離站（A2），格式跟舊版一樣
    557_人數_日期.csv   車上人數（A3）
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
SHORT = {START: "天文館", "212024": "科教館", "171175": "士林高商", "187538": "行政中心",
         JHS: "士林國中", MRT: "士林站", SCHOOL: "東吳"}
LEVEL_NAMES = {1: "舒適", 2: "中等", 3: "擁擠"}
POLL_SECONDS = 15
TAIL_MINUTES = 30        # 結束時間後再追一下，等最後幾班開到東吳
EXCEL_EVERY_SECONDS = 60
A3_WINDOW = timedelta(minutes=3)    # 離站後幾分鐘內回報的人數才算「離開這一站」的
A3_EARLY = timedelta(seconds=10)    # 進站紀錄可能比人數回報晚幾秒
A3_SPLIT = timedelta(seconds=5)     # 離站後 5 秒內的回報當成還在站上（進站那次）
TRIP_GAP = timedelta(minutes=30)    # 同一台車去程中隔這麼久沒有新紀錄，就當成下一趟
SLOT_MINUTES = 15

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
             "士林站淨上車(人)", "跟前一班到士林站間隔(分)", "備註"])

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
            + [count(t["士林站人數"]) - count(came) if came and t["士林站人數"] else "", t["間隔"], "；".join(t["備註"])])


def write_excel(path, trips, events, crowds, day, incomplete=()):
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
    autosize(ws, [5, 10] + [9] * len(TIME_COLS) + [9] * (len(GAP_COLS) + 1) + [8, 7] * len(CROWD_POINTS) + [9, 9, 45])

    st = wb.create_sheet("每15分鐘")
    st.append([f"{day:%Y-%m-%d} 依「到捷運士林站的時間」每 {SLOT_MINUTES} 分鐘分組。"
               "間隔＝這班跟前一班到士林站差幾分鐘；人數是離開士林站時車上的人數"])
    header(st, ["時段", "班次", "平均間隔(分)", "最長間隔(分)", "離開士林站平均人數", "最多人數",
                "擁擠班次", "中等班次", "舒適班次", "沒人數的班次", "天文館→士林國中平均(分)", "士林站→東吳平均(分)"])
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
                   levels.count(3), levels.count(2), levels.count(1), len(ts) - len(counts), avg(to_jhs), avg(rides)])
    autosize(st, [14, 7, 12, 12, 16, 10, 10, 10, 10, 12, 18, 18])

    bad = wb.create_sheet("資料不完整")
    bad.append(["這些趟次不知道幾點到士林站（GPS 斷線、監測開始時已開過、或結束時還在路上），"
                "所以沒算進「每班車」和間隔。GPS 斷線多的時段，間隔會被算大。"])
    header(bad, ["車牌", "天文館發車", "最後一筆紀錄時間", "最後一筆在哪一站", "沒列進每班車的原因", "備註"])
    for t in sorted(incomplete, key=lambda t: t["最後紀錄"][0]):
        bad.append([t["車牌"], t["發車"], t["最後紀錄"][0], t["最後紀錄"][1], t["沒列原因"], "；".join(t["備註"])])
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
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", help="監測日期 YYYY-MM-DD（預設：下一個 07:00 所在日）")
    ap.add_argument("--start", default="07:00")
    ap.add_argument("--end", default="19:00")
    ap.add_argument("--now", action="store_true", help="立刻開始")
    ap.add_argument("--minutes", type=int, help="搭配 --now：跑幾分鐘")
    ap.add_argument("--outdir", default=os.path.join(root, "data", "557監測"))
    ap.add_argument("--rebuild", metavar="日期", help="只用這一天的原始紀錄重新產生 Excel")
    args = ap.parse_args()

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
    xlsx_path = os.path.join(args.outdir, f"557監測_{tag}{day:%Y-%m-%d}.xlsx")

    def save(events, crowds):
        incomplete = []
        trips = in_window(build_trips(events, crowds, incomplete), win_start, win_end)
        incomplete = [t for t in incomplete if win_start <= t["最後紀錄"][0] <= win_end + tail]
        return write_excel(xlsx_path, trips, events, crowds, day, incomplete), trips

    if args.rebuild:
        save(load_csv(raw_path, event_key), load_csv(crowd_path, crowd_key))
        log(f"已產生 {xlsx_path}")
        return

    keep_awake(True)
    log(f"監測時段 {win_start:%Y-%m-%d %H:%M} – {win_end:%H:%M}，輸出到 {args.outdir}")
    while (win_start - datetime.now()).total_seconds() > 0:
        time.sleep(min(60, max(1, (win_start - datetime.now()).total_seconds())))

    events, crowds = load_csv(raw_path, event_key), load_csv(crowd_path, crowd_key)  # 中途重開會接續
    seen_e, seen_c = {event_key(e) for e in events}, {crowd_key(c) for c in crowds}
    files = []
    writers = []
    for path, fields in ((raw_path, RAW_FIELDS), (crowd_path, CROWD_FIELDS)):
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
            new_e, new_c = parse(fetch(), datetime.now())
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
                        log(f"{c['車牌']} 離開{STOP_NAMES[c['站牌ID']]}：{c['車上人數']} 人（{LEVEL_NAMES[level_of(c)]}）")
            for f in files:
                f.flush()
        except Exception as ex:  # 網路暫時失敗就下一輪再試
            fails += 1
            log(f"抓取失敗（第 {fails} 次）：{ex}")
        if time.time() - last_excel > EXCEL_EVERY_SECONDS:
            last_excel = time.time()
            ok, trips = save(events, crowds)
            if ok:
                log(f"Excel 已更新：{len(trips)} 班經過士林站")
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
    while not save(events, crowds)[0]:
        log(f"請關掉 Excel 裡的 {os.path.basename(xlsx_path)}，關掉後會自動存好……")
        time.sleep(10)
    keep_awake(False)
    log(f"完成！結果在 {xlsx_path}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
