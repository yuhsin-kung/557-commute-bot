# /// script
# dependencies = ["openpyxl"]
# ///
"""557 到校時間預測 v0：用前幾天的監測資料，預測「幾點到士林站（或士林國中），大概幾點到東吳」

做法（到校時間預測.md 第五、六節）：
  等車：假設你某一分鐘到站，看訓練那幾天「下一班還有空位的車」是幾點來（直接重播當天的車，不用平均班距 ÷ 2）
  車程：上那班車的時間前後 N 分鐘內，訓練資料裡所有車的車程中位數（滑動時間窗）
  預測到東吳 = 到站時間 + 等車（各天中位數）+ 車程；最晚 = 到站時間 + 等車最多那天 + 窗口內最慢的車程
「還有空位」＝ 這班車離開這一站時，以 70 人算至少還剩 k 個位置（用實際人數範圍的下限）。
網站看不到排隊人數，所以 k 是假設，5、10、20 三種都算。

對答案：用那一天實際的車，照同樣規則算「真的會在幾點到東吳」，跟預測比，也跟 Bot 現在的算法比
（Bot：557 一律 12 分鐘，07:20–08:20、09:00–10:00 尖峰再加 10 分鐘）。

  預測：uv run tools/預測557.py predict --target 2026-11-26
  對答案：uv run tools/預測557.py evaluate --target 2026-11-26
"""
import argparse
import csv
import importlib.util
import os
import statistics
import sys
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("monitor557", os.path.join(HERE, "557監測.py"))
mon = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mon)

DATA_DIR = os.path.normpath(os.path.join(HERE, "..", "data", "557監測"))
OUT_DIR = os.path.normpath(os.path.join(HERE, "..", "預測紀錄"))
STOPS = {"士林站": mon.MRT, "士林國中": mon.JHS}
SEATS = (5, 10, 20)          # 至少剩幾個位置才算上得去（假設）
WINDOW = timedelta(minutes=10)
MAX_WAIT = timedelta(minutes=45)  # 等超過這麼久還沒有車，就當成那天這個時間沒資料
OUTAGE = timedelta(minutes=5)     # 監測超過這麼久沒抓到任何資料（關機、睡眠、斷網），中間這段當作沒資料
DAY_START, DAY_END = "07:00", "18:30"
BOT_RIDE, BOT_PEAK_EXTRA = 12, 10
BOT_PEAKS = (("07:20", "08:20"), ("09:00", "10:00"))
PRED_FIELDS = ["日期", "站", "到站時間", "空位門檻", "預測到東吳", "最晚到東吳", "預測等車(分)", "預測車程(分)",
               "用了哪幾天", "Bot估計到東吳"]


def load_day(day, data_dir=DATA_DIR):
    """一天的監測 CSV → 每班去程（用 557監測.py 同一套整理規則）"""
    raw = os.path.join(data_dir, f"557_raw_{day}.csv")
    crowd = os.path.join(data_dir, f"557_人數_{day}.csv")
    if not os.path.exists(raw):
        raise SystemExit(f"找不到 {raw}，那天有跑監測嗎？")
    events = mon.load_csv(raw, mon.event_key)
    crowds = mon.fresh(mon.load_csv(crowd, mon.crowd_key))
    out = Day(buses(mon.build_trips(events, crowds)))
    out.gaps = load_gaps(day, data_dir)
    return out


class Day(list):
    """一天的車，另外記著監測斷掉的時段 gaps：[(最後一次抓到, 下一次抓到), …]"""
    gaps = ()


def load_gaps(day, data_dir=DATA_DIR):
    """三個 CSV 的「抓取時間」合起來，相鄰兩次隔超過 OUTAGE 的就是斷掉的時段。
    11/26 有三段：14:16–15:03 關機、16:58–17:10 電腦睡眠、17:42–18:44 Wi-Fi 斷線"""
    stamps = set()
    for name in ("raw", "人數", "預估"):
        path = os.path.join(data_dir, f"557_{name}_{day}.csv")
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8-sig", newline="") as f:
            for row in csv.DictReader(f):
                if row.get("抓取時間"):
                    stamps.add(datetime.strptime(row["抓取時間"], "%Y-%m-%d %H:%M:%S"))
    stamps = sorted(stamps)
    return [(a, b) for a, b in zip(stamps, stamps[1:]) if b - a > OUTAGE]


def seen(day_buses, start, end):
    """start 到 end 之間監測都有在跑（沒有斷掉的時段），這段算出來的等車才可信"""
    return not any(a < end and b > start for a, b in getattr(day_buses, "gaps", ()))


def buses(trips):
    """每班車整理成：在士林國中、士林站的時間，到東吳的時間，離開那一站時至少剩幾個位置"""
    out = []
    for t in trips:
        school = t["時間"].get(mon.SCHOOL)
        if not school:
            continue
        upstream = int(t["國中到站人數"]["車上人數"]) if t["國中到站人數"] else 0
        row = {"車牌": t["車牌"], "車輛ID": t["車輛ID"], "東吳": school, "到站": {}, "剩位": {}}
        for name, stop, crowd in (("士林站", mon.MRT, t["士林站人數"]), ("士林國中", mon.JHS, t["國中人數"])):
            at = t["參考"] if stop == mon.MRT else t["時間"].get(stop)
            if not at:
                continue
            row["到站"][name] = at
            # 在國中以前上車的人可能在士林站沒刷卡下車 → 用實際人數範圍的下限；沒有人數就當作不知道（None）
            row["剩位"][name] = mon.CAPACITY - max(0, int(crowd["車上人數"]) - upstream) if crowd else None
        out.append(row)
    return sorted(out, key=lambda b: b["東吳"])


def first_bus(day_buses, stop, at, seats):
    """at 之後第一班到這一站、還剩至少 seats 個位置的車；人數不知道的車當作上得去"""
    for b in sorted((b for b in day_buses if stop in b["到站"]), key=lambda b: b["到站"][stop]):
        if b["到站"][stop] < at:
            continue
        if b["到站"][stop] - at > MAX_WAIT:
            return None
        left = b["剩位"][stop]
        if left is None or left >= seats:
            return b
    return None


def covers(day_buses, stop, at):
    """這一天在 at 前後都有監測到車（11/24 只跑了 17 點以後，早上就不能用）"""
    times = [b["到站"][stop] for b in day_buses if stop in b["到站"]]
    return bool(times) and min(times) - timedelta(minutes=15) <= at <= max(times)


def on_day(clock, day):
    return datetime.strptime(f"{day} {clock}", "%Y-%m-%d %H:%M")


def bot_estimate(at):
    hm = at.strftime("%H:%M")
    peak = any(a <= hm <= b for a, b in BOT_PEAKS)
    return at + timedelta(minutes=BOT_RIDE + (BOT_PEAK_EXTRA if peak else 0))


def wait_samples(day_buses, stop, center, seats, window):
    """center 前後 window 內每一分鐘到站，各要等幾分鐘才有還剩 seats 個位置的車"""
    out, t = [], center - window
    while t <= center + window:
        b = first_bus(day_buses, stop, t, seats) if covers(day_buses, stop, t) else None
        if b and seen(day_buses, t, b["到站"][stop]):  # 等車的那段監測有斷掉，就不知道中間有沒有車
            out.append((b["到站"][stop] - t).total_seconds() / 60)
        t += timedelta(minutes=1)
    return out


def pct90(xs):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, round(0.9 * (len(xs) - 1)))]


def predict(train, target, window=WINDOW, smooth=True):
    """train：{日期: 那天的車}。回傳每一分鐘、每一站、每一種空位門檻的預測"""
    rows = []
    start, end = on_day(DAY_START, target), on_day(DAY_END, target)
    minute = start
    while minute <= end:
        for name in STOPS:
            for seats in SEATS:
                waits, used = [], []
                for day, day_buses in train.items():
                    at = on_day(minute.strftime("%H:%M"), day)
                    if not covers(day_buses, name, at):
                        continue
                    # 每天車來的時間不一樣，只重播「那一分鐘」的下一班等於在猜；
                    # 改成前後 window 內每一分鐘到站各要等多久，全部收集起來看分布（滑動時間窗）
                    got = wait_samples(day_buses, name, at, seats, window if smooth else timedelta(0))
                    if got:
                        waits += got
                        used.append(day)
                row = {"日期": target, "站": name, "到站時間": minute.strftime("%H:%M"), "空位門檻": seats,
                       "預測到東吳": "", "最晚到東吳": "", "預測等車(分)": "", "預測車程(分)": "",
                       "用了哪幾天": "、".join(d[5:] for d in used), "Bot估計到東吳": bot_estimate(minute).strftime("%H:%M")}
                if waits:
                    wait = statistics.median(waits)
                    rides = ride_window(train, name, minute + timedelta(minutes=wait), window)
                    if rides:
                        ride = statistics.median(rides)
                        row.update({"預測到東吳": (minute + timedelta(minutes=wait + ride)).strftime("%H:%M"),
                                    "最晚到東吳": (minute + timedelta(minutes=pct90(waits) + max(rides))).strftime("%H:%M"),
                                    "預測等車(分)": round(wait, 1), "預測車程(分)": round(ride, 1)})
                rows.append(row)
        minute += timedelta(minutes=1)
    return rows


def ride_window(train, stop, center, window):
    """訓練資料裡，到這一站的時間在 center 前後 window 內的車，從這一站到東吳各花幾分鐘"""
    out = []
    for day, day_buses in train.items():
        c = on_day(center.strftime("%H:%M"), day)
        for b in day_buses:
            at = b["到站"].get(stop)
            if at and abs(at - c) <= window:
                out.append((b["東吳"] - at).total_seconds() / 60)
    return out


def actual(day_buses, stop, at, seats):
    """那一天真的在 at 到站，照同樣規則（等到還剩 seats 個位置的車）幾點到東吳。
    等車那段監測有斷掉就回傳 None（不知道中間有沒有車，不拿來對答案）"""
    b = first_bus(day_buses, stop, at, seats)
    if not b or not seen(day_buses, at, b["到站"][stop]):
        return None
    return b["東吳"]


def hm(day, s):
    return on_day(s, day) if s else None


def evaluate(pred_rows, target_buses, target):
    """每一列預測對答案；回傳 (逐列結果, 依站/門檻/時段的成績)"""
    detail = []
    for r in pred_rows:
        at = on_day(r["到站時間"], target)
        truth = actual(target_buses, r["站"], at, int(r["空位門檻"]))
        if not truth or not covers(target_buses, r["站"], at):
            continue
        p, late, bot = hm(target, r["預測到東吳"]), hm(target, r["最晚到東吳"]), hm(target, r["Bot估計到東吳"])
        err = lambda x: round((truth - x).total_seconds() / 60, 1) if x else None
        detail.append({**r, "實際到東吳": truth.strftime("%H:%M"), "誤差(分)": err(p), "Bot誤差(分)": err(bot),
                       "沒超過最晚": (truth <= late) if late else None})
    return detail, summarize(detail)


PERIODS = (("07:00–08:30 早上尖峰", "07:00", "08:30"), ("08:30–10:15 第二波", "08:30", "10:15"),
           ("10:15–17:00 白天", "10:15", "17:00"), ("17:00–18:30 傍晚", "17:00", "18:31"))


def summarize(detail):
    out = []
    for name in STOPS:
        for seats in SEATS:
            for label, a, b in (("全天", "00:00", "23:59"),) + PERIODS:
                g = [d for d in detail if d["站"] == name and int(d["空位門檻"]) == seats and a <= d["到站時間"] < b]
                ours = [d["誤差(分)"] for d in g if d["誤差(分)"] is not None]
                bot = [d["Bot誤差(分)"] for d in g]
                cover = [d["沒超過最晚"] for d in g if d["沒超過最晚"] is not None]
                if not ours:
                    continue
                pct = lambda xs, lim: round(100 * sum(abs(x) <= lim for x in xs) / len(xs))
                out.append({"站": name, "空位門檻": seats, "時段": label, "分鐘數": len(ours),
                            "平均差幾分(我們)": round(statistics.mean(abs(x) for x in ours), 1),
                            "平均差幾分(Bot)": round(statistics.mean(abs(x) for x in bot), 1),
                            "±3分內%(我們)": pct(ours, 3), "±3分內%(Bot)": pct(bot, 3),
                            "±5分內%(我們)": pct(ours, 5), "±5分內%(Bot)": pct(bot, 5),
                            "偏晚還是偏早(我們，正的=實際比預測晚)": round(statistics.mean(ours), 1),
                            "實際沒超過最晚%": round(100 * sum(cover) / len(cover)) if cover else ""})
    return out


def realtime_case(etas, train, target_buses, target, window=WINDOW):
    """情況 A（車已經在路上）：等車用網站即時預估，車程用訓練資料的滑動窗。
    每一分鐘看網站對士林國中／士林站最新的一筆預估（那台車幾秒後到），
    預測到東吳 = 網站說的到站時間 + 車程中位數；實際 = 那台車真的幾點到東吳。
    網站只給「下一班」，這班擠不上的話網站也不知道下一班，所以這裡不看空位，只比時間準不準"""
    by_id = {}
    for b in target_buses:  # 一台車一天跑好幾趟
        by_id.setdefault(b["車輛ID"], []).append(b)

    def trip_of(vid, stop, comes):
        """網站說這台車 comes 到站：對到這台車時間最接近的那一趟（差 20 分鐘以上就不算）"""
        cand = [b for b in by_id.get(vid, []) if stop in b["到站"]]
        best = min(cand, key=lambda b: abs(b["到站"][stop] - comes), default=None)
        return best if best and abs(best["到站"][stop] - comes) <= timedelta(minutes=20) else None
    latest = {}
    for x in sorted(etas, key=lambda x: x["資料時間"]):
        name = next((n for n, s in STOPS.items() if s == x["站牌ID"]), None)
        if name and int(x["預估秒數"]) > 0:
            latest.setdefault(name, []).append(x)
    out = []
    start, end = on_day(DAY_START, target), on_day(DAY_END, target)
    # 對照組：網站到站時間＋整天車程的中位數（不分時段）。用來看「依時段算車程」到底有沒有幫助
    flat = {n: statistics.median([(b["東吳"] - b["到站"][n]).total_seconds() / 60
                                  for bs in train.values() for b in bs if n in b["到站"]] or [0]) for n in STOPS}
    for name, xs in latest.items():
        i, minute = 0, start
        while minute <= end:
            while i + 1 < len(xs) and datetime.strptime(xs[i + 1]["資料時間"], "%Y-%m-%d %H:%M:%S") <= minute:
                i += 1
            x = xs[i]
            seen = datetime.strptime(x["資料時間"], "%Y-%m-%d %H:%M:%S")
            comes = seen + timedelta(seconds=int(x["預估秒數"]))
            b = trip_of(x["車輛ID"], name, comes)
            if seen <= minute and minute - seen <= timedelta(minutes=1) and b:
                rides = ride_window(train, name, comes, window)
                if rides and comes >= minute:
                    pred = comes + timedelta(minutes=statistics.median(rides))
                    err = lambda p: round((b["東吳"] - p).total_seconds() / 60, 1)
                    out.append({"站": name, "到站時間": minute.strftime("%H:%M"), "網站說幾點到站": comes.strftime("%H:%M"),
                                "車牌": b["車牌"], "預測到東吳": pred.strftime("%H:%M"), "實際到東吳": b["東吳"].strftime("%H:%M"),
                                "誤差(分)": err(pred), "Bot誤差(分)": err(bot_estimate(minute)),
                                "網站+固定車程誤差(分)": err(comes + timedelta(minutes=flat[name]))})
            minute += timedelta(minutes=1)
    return out


def summarize_realtime(rows):
    out = []
    for name in STOPS:
        for label, a, b in (("全天", "00:00", "23:59"),) + PERIODS:
            g = [r for r in rows if r["站"] == name and a <= r["到站時間"] < b]
            if not g:
                continue
            ours, bot = [r["誤差(分)"] for r in g], [r["Bot誤差(分)"] for r in g]
            flat = [r["網站+固定車程誤差(分)"] for r in g]
            pct = lambda xs, lim: round(100 * sum(abs(x) <= lim for x in xs) / len(xs))
            mae = lambda xs: round(statistics.mean(abs(x) for x in xs), 1)
            out.append({"站": name, "時段": label, "分鐘數": len(g),
                        "平均差幾分(網站+我們的車程)": mae(ours), "平均差幾分(網站+固定車程)": mae(flat),
                        "平均差幾分(Bot)": mae(bot),
                        "±3分內%(網站+我們的車程)": pct(ours, 3), "±3分內%(網站+固定車程)": pct(flat, 3),
                        "±3分內%(Bot)": pct(bot, 3),
                        "偏晚還是偏早(正的=實際比預測晚)": round(statistics.mean(ours), 1)})
    return out


def write_csv(path, rows, fields, note=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        if note:
            f.write(note + "\n")
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)


def read_predictions(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        lines = f.read().splitlines()
    start = next(i for i, line in enumerate(lines) if line.startswith("日期,"))
    return list(csv.DictReader(lines[start:]))


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # Windows 主控台預設編碼印不出中文
    except (AttributeError, ValueError):
        pass
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("mode", choices=["predict", "evaluate"])
    p.add_argument("--target", required=True, help="要預測／對答案的日期，例如 2026-11-26")
    p.add_argument("--train", nargs="+", default=["2026-11-25", "2026-11-24"],
                   help="用哪幾天的資料（只跑了半天的會自動只用有資料的時段）")
    p.add_argument("--window", type=int, default=10, help="車程的滑動時間窗，前後幾分鐘")
    p.add_argument("--data", default=DATA_DIR)
    p.add_argument("--out", default=OUT_DIR)
    a = p.parse_args()
    pred_path = os.path.join(a.out, f"557預測_{a.target}.csv")

    if a.mode == "predict":
        train = {d: load_day(d, a.data) for d in a.train}
        rows = predict(train, a.target, timedelta(minutes=a.window))
        note = (f"# 557 到校時間預測 v0，產生時間 {datetime.now():%Y-%m-%d %H:%M}（{a.target} 的資料還沒收），"
                f"用 {'、'.join(a.train)} 的資料，車程窗口前後 {a.window} 分鐘")
        write_csv(pred_path, rows, PRED_FIELDS, note)
        filled = sum(1 for r in rows if r["預測到東吳"])
        print(f"已寫入 {pred_path}：{len(rows)} 列，有預測 {filled} 列")
        return

    target_buses = load_day(a.target, a.data)
    detail, summary = evaluate(read_predictions(pred_path), target_buses, a.target)
    write_csv(os.path.join(a.out, f"557對答案_{a.target}.csv"), detail,
              PRED_FIELDS + ["實際到東吳", "誤差(分)", "Bot誤差(分)", "沒超過最晚"])
    write_csv(os.path.join(a.out, f"557成績_{a.target}.csv"), summary, list(summary[0]) if summary else ["站"])
    print("【情況 B：只用歷史資料，事先預測】")
    for s in summary:
        if s["空位門檻"] == 10:
            print(f"  {s['站']} {s['時段']}：我們平均差 {s['平均差幾分(我們)']} 分、±3分內 {s['±3分內%(我們)']}%；"
                  f"Bot 平均差 {s['平均差幾分(Bot)']} 分、±3分內 {s['±3分內%(Bot)']}%")
    eta_path = os.path.join(a.data, f"557_預估_{a.target}.csv")
    if os.path.exists(eta_path):
        train = {d: load_day(d, a.data) for d in a.train if d != a.target}
        rt = realtime_case(mon.load_csv(eta_path, mon.eta_key), train, target_buses, a.target, timedelta(minutes=a.window))
        rs = summarize_realtime(rt)
        if rt:
            write_csv(os.path.join(a.out, f"557即時對答案_{a.target}.csv"), rt, list(rt[0]))
            write_csv(os.path.join(a.out, f"557即時成績_{a.target}.csv"), rs, list(rs[0]))
        print("【情況 A：等車用網站即時預估，車程用我們的滑動窗】")
        for s in rs:
            print(f"  {s['站']} {s['時段']}：平均差 {s['平均差幾分(網站+我們的車程)']} 分、±3分內 {s['±3分內%(網站+我們的車程)']}%；"
                  f"網站+固定車程 {s['平均差幾分(網站+固定車程)']} 分、{s['±3分內%(網站+固定車程)']}%；"
                  f"Bot {s['平均差幾分(Bot)']} 分、{s['±3分內%(Bot)']}%")


if __name__ == "__main__":
    main()
