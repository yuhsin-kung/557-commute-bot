# /// script
# dependencies = ["openpyxl", "scikit-learn", "numpy"]
# ///
"""557 尖峰排隊預測：學生 N 分鐘後到士林國中或捷運士林站，要等第幾台、幾點到東吳（11/28）

「要排」的車（有人被留下）：
  士林國中：離開國中是紅色，而且下一台也是紅色。連續紅色 k 台，前 k−1 台要排，最後一台把隊伍載完
           （團隊 11/28 定的；四天 3 段連續紅色，結束後下一台在國中都只上 3–22 人，吻合）
  捷運士林站：團隊的顏色規則（國中紅 → 要排；士林站綠黃 → 不用；國中綠黃、士林站紅 → 60 人以上才要排）

實際答案（範圍）：學生到站後
  第一台不用排 → 就搭它；
  第一台要排 → 先到先上，最快搭下一台，最晚搭第一台不用排的車（最晚一定清空）

預測：
  1. 第一台幾點到東吳：零件模型（每一分鐘模擬 200 次）
  2. 要多等多久：訓練那幾天、同一個時間前後 10 分鐘，照上面規則算「最快、最晚比第一台晚幾分」
  3. 現在的狀態：最近一台離開國中的車是紅色 → 正在連續紅色，只拿歷史上「當時也是紅色」的時間比
     （樣本少於 5 筆就不分狀態）
  範圍 = 第一台＋最快多等（中位數）～ 第一台＋最晚多等（P80）

  uv run tools/尖峰排隊預測557.py
"""
import argparse
import os
import sys
from datetime import datetime, timedelta

import numpy as np

import importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("parts557", os.path.join(HERE, "零件模型557.py"))
Z = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(Z)
L, p, mon = Z.L, Z.p, Z.mon

TOL = 3
ANALOG = 10            # 歷史同時段：前後幾分鐘
RED_RECENT = 15        # 最近幾分鐘內離開國中的車才算「現在的狀態」
MIN_MATCH = 5
START, END = "07:00", "10:30"
WALK_TO_JHS = 5        # 捷運士林站走到士林國中站牌約 5 分鐘（團隊 11/28）
STOPS = {"士林國中": Z.JHS_POS, "捷運士林站": Z.MRT}


def stop_rows(trips, day_buses):
    """每台車：到國中、到士林站、到東吳的時間，離開國中的顏色和幾點知道，士林站要不要排"""
    by = {(b["車輛ID"], b["到站"].get("士林站")): b for b in day_buses if "士林站" in b["到站"]}
    rows = []
    for t in trips:
        b = by.get((t["車輛ID"], t["參考"])) if t["參考"] else None
        if not b or not b.get("東吳"):
            continue
        ok = not t.get("人數不可信") and t.get("國中人數")
        rows.append({"士林國中": b["到站"].get("士林國中"), "捷運士林站": b["到站"]["士林站"], "東吳": b["東吳"],
                     "red": bool(ok and int(t["國中人數"]["擁擠等級"]) == 3),
                     "red_at": datetime.strptime(t["國中人數"]["回報時間"], "%Y-%m-%d %H:%M:%S") if ok else None,
                     "mrt_q": bool(Z.must_queue(t))})
    rows.sort(key=lambda r: r["捷運士林站"])
    for i, r in enumerate(rows):
        r["jhs_q"] = r["red"] and i + 1 < len(rows) and rows[i + 1]["red"]
    return rows


def label(stop):
    return "jhs_q" if stop == "士林國中" else "mrt_q"


def truth(rows, stop, go):
    """(第一台到東吳, 最快, 最晚)；第一台不用排三個都一樣。45 分鐘內沒車就 None"""
    seq = [r for r in rows if r[stop] and r[stop] >= go]
    seq.sort(key=lambda r: r[stop])
    if not seq or seq[0][stop] - go > p.MAX_WAIT:
        return None
    q = label(stop)
    first = seq[0]
    if not first[q]:
        return first["東吳"], first["東吳"], first["東吳"]
    clear = next((r for r in seq if not r[q]), None)
    if not clear or clear[stop] - go > p.MAX_WAIT or len(seq) < 2:
        return None
    return first["東吳"], seq[1]["東吳"], clear["東吳"]


def red_now(rows, t):
    """t 這一刻：最近一台已經離開國中的車是不是紅色（最近 15 分鐘內）"""
    past = [r for r in rows if r["red_at"] and r["red_at"] <= t and t - r["red_at"] <= timedelta(minutes=RED_RECENT)]
    return bool(past) and max(past, key=lambda r: r["red_at"])["red"]


def history(rows_by_day, stop, n):
    """訓練那幾天每一分鐘：(幾點到站, 當時（n 分鐘前查）是不是紅色, 最快多等, 最晚多等)"""
    out = []
    for day, rows in rows_by_day.items():
        go = p.on_day(START, day)
        while go <= p.on_day(END, day):
            tr = truth(rows, stop, go)
            if tr:
                f, lo, hi = tr
                out.append((L.tod(go), red_now(rows, go - timedelta(minutes=n)),
                            (lo - f).total_seconds() / 60, (hi - f).total_seconds() / 60))
            go += timedelta(minutes=1)
    return np.array(out, float) if out else np.zeros((0, 4))


def extra(hist, tod, state=None):
    """歷史同時段的 (最快多等中位數, 最晚多等 P80, 第一台要排的比例, 用了幾筆)"""
    near = hist[np.abs(hist[:, 0] - tod) <= ANALOG] if len(hist) else hist
    if state is not None and len(near):
        same = near[near[:, 1] == float(state)]
        if len(same) >= MIN_MATCH:
            near = same
    if not len(near):
        return 0.0, 10.0, 0.5, 0
    return float(np.median(near[:, 2])), float(np.percentile(near[:, 3], 80)), float(np.mean(near[:, 3] > 0)), len(near)


def pick_kth(sims_out, n, k, fallback):
    """每次模擬挑 n 分鐘後第 k 台到這一站的車，回傳到東吳的分鐘數"""
    if not sims_out:
        return np.full(Z.SIMS, float(fallback))
    M = np.stack([m for m, _ in sims_out])
    S = np.stack([s for _, s in sims_out])
    M = np.where(M >= n, M, np.inf)
    if M.shape[0] < k:
        return np.full(M.shape[1], float(fallback))
    idx = np.argsort(M, axis=0)[k - 1]
    cols = np.arange(M.shape[1])
    ok = np.isfinite(M[idx, cols]) & (M[idx, cols] - n <= p.MAX_WAIT.total_seconds() / 60)
    return np.where(ok, S[idx, cols], fallback)


def slot_table(rows_by_day):
    """四天全部：每 15 分鐘、每個上車站，第一台要排的比例、要排時多等幾分（中位數、最多）"""
    out = []
    for stop in STOPS:
        h = history(rows_by_day, stop, 0)
        for s in range(int(L.tod(p.on_day(START, "2026-11-25"))), int(L.tod(p.on_day(END, "2026-11-25"))), 15):
            x = h[(h[:, 0] >= s) & (h[:, 0] < s + 15)]
            if not len(x):
                continue
            q = x[x[:, 3] > 0]
            out.append({"上車站": stop, "到站時段": f"{s // 60:02d}:{s % 60:02d}–{(s + 15) // 60:02d}:{(s + 15) % 60:02d}",
                        "第一台要排%": round(100 * len(q) / len(x)),
                        "要排時最快多等（中位數，分）": round(float(np.median(q[:, 2])), 1) if len(q) else "",
                        "要排時最晚多等（中位數，分）": round(float(np.median(q[:, 3])), 1) if len(q) else "",
                        "要排時最晚多等（最多，分）": round(float(q[:, 3].max()), 1) if len(q) else "",
                        "建議預留（分）": round(float(np.percentile(x[:, 3], 80))), "分鐘數": len(x)})
    return out


def exam(days, tests, data_dir=p.DATA_DIR, seed=0):
    """回傳 {(上車站, n, 方法): {考卷: [(下限對, 上限對, 寬度, 第一台要排, 尖峰, 中點差)]}}"""
    rng = np.random.default_rng(seed)
    buses = {d: p.load_day(d, data_dir) for d in days}
    events = {d: L.load_events(d, data_dir) for d in days}
    vis = {d: {v: Z.visits(xs) for v, xs in events[d].items()} for d in days}
    segs = {d: Z.segments(vis[d], buses[d]) for d in days}
    rows = {d: stop_rows(L.load_trips(d, data_dir), buses[d]) for d in days}
    out = {}
    for test in tests:
        train = [d for d in days if d != test]
        table = Z.Table([s for d in train for s in segs[d]])
        hist = {(s, n): history({d: rows[d] for d in train}, s, n) for s in STOPS for n in L.AHEAD}
        t, end = p.on_day(START, test) - timedelta(minutes=max(L.AHEAD)), p.on_day(END, test)
        while t <= end:
            sims = {}
            state = red_now(rows[test], t)
            fac = None
            for stop, pos in STOPS.items():
                for n in L.AHEAD:
                    go = t + timedelta(minutes=n)
                    if not p.on_day(START, test) <= go <= end:
                        continue
                    tr = truth(rows[test], stop, go)
                    if not tr:
                        continue
                    f_real, lo, hi = tr
                    first_at = next(r[stop] for r in sorted((r for r in rows[test] if r[stop] and r[stop] >= go), key=lambda r: r[stop]))
                    if not p.seen(buses[test], t, first_at):
                        continue
                    if stop not in sims:
                        fac = Z.today_factor(segs[test], t, table) if fac is None else fac
                        sims[stop] = Z.simulate(vis[test], t, table, fac, rng, board=pos, alight=Z.SCHOOL)
                    fb = n + Z.hist_wait(buses, train, go, "士林國中" if stop == "士林國中" else "士林站") + \
                        (Z.hist_ride(buses, train, go, "士林國中" if stop == "士林國中" else "士林站"))
                    first = Z.pick(sims[stop], n, fb)
                    f50 = float(np.median(first))
                    at = lambda m: t + timedelta(minutes=float(m))
                    second = pick_kth(sims[stop], n, 2, fb + 10)
                    s50 = float(np.median(second))
                    e_all = extra(hist[(stop, n)], L.tod(go))
                    e_st = extra(hist[(stop, n)], L.tod(go), state)
                    skip = state and stop == "捷運士林站" and n == 0   # 士林站：現在連續紅色，第一台 72% 要排
                    ranges = {
                        "只推第一台（P20～P80，沒算排隊）": (at(np.percentile(first, 20)), at(np.percentile(first, 80))),
                        "排隊範圍：第一台～（第二台、歷史最晚多等）取晚的": (at(f50), at(max(s50, f50 + e_all[1]))),
                        "排隊範圍＋現在連續紅色": (at(s50 if skip else f50), at(max(s50, f50 + e_st[1]))),
                    }
                    mid_real = lo + (hi - lo) / 2
                    for k, (a, b) in ranges.items():
                        v = (float(a <= lo + timedelta(minutes=TOL)), float(b >= hi - timedelta(minutes=TOL)),
                             (b - a).total_seconds() / 60, hi > f_real, Z.in_out_peak(go),
                             abs(((a + (b - a) / 2) - mid_real).total_seconds() / 60))
                        out.setdefault((stop, n, k), {}).setdefault(test, []).append(v)
            t += timedelta(minutes=1)
        print(f"{test} 考完", file=sys.stderr)
    return out


def summarize(out):
    rows = []
    for scope, keep in (("早上 07:00–10:30", lambda x: True), ("尖峰（07:30–08:00、09:15–10:00）", lambda x: x[4])):
        for (stop, n, k), by_day in sorted(out.items()):
            for day in ["全部"] + sorted(by_day):
                xs = [v for d, es in by_day.items() if day in ("全部", d) for v in es if keep(v)]
                if not xs:
                    continue
                a = np.array([x[:3] + (x[5],) for x in xs])
                qd = np.array([x[1] for x in xs if x[3]])
                rows.append({"範圍": scope, "上車站": stop, "情況": ("人已經在站牌" if n == 0 else f"{n} 分鐘後到站牌"), "方法": k,
                             "考卷": day if day == "全部" else day[5:],
                             "下限對%": round(100 * a[:, 0].mean()), "上限對%": round(100 * a[:, 1].mean()),
                             "都對%": round(100 * (a[:, 0] * a[:, 1]).mean()),
                             "第一台要排時上限對%": round(100 * qd.mean()) if len(qd) else "",
                             "第一台要排%": round(100 * np.mean([x[3] for x in xs])),
                             "中點差（分）": round(float(a[:, 3].mean()), 2),
                             "平均寬度（分）": round(float(a[:, 2].mean()), 1), "筆數": len(xs)})
    return rows


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--days", nargs="+", default=L.DAYS)
    ap.add_argument("--data", default=p.DATA_DIR)
    ap.add_argument("--out", default=p.OUT_DIR)
    a = ap.parse_args()
    rows = summarize(exam(a.days, a.days, a.data))
    for r in rows:
        if r["考卷"] == "全部":
            print(f"{r['範圍']} | {r['上車站']} | {r['情況']} | {r['方法']}：下限對 {r['下限對%']}%、上限對 {r['上限對%']}%"
                  f"（第一台要排 {r['第一台要排%']}% 的時候 {r['第一台要排時上限對%']}%）、都對 {r['都對%']}%、"
                  f"中點差 {r['中點差（分）']} 分、寬 {r['平均寬度（分）']} 分（{r['筆數']} 筆）")
    data = {d: stop_rows(L.load_trips(d, a.data), p.load_day(d, a.data)) for d in a.days}
    table = slot_table(data)
    tpath = os.path.join(a.out, f"557尖峰排隊時段表_{a.days[-1]}.csv")
    p.write_csv(tpath, table, list(table[0].keys()),
                "# 每 15 分鐘：第一台要排的比例、要排時多等幾分。建議預留＝多等時間的 P80（含不用排的時候）。四天全部資料")
    for r in table:
        print(f"{r['上車站']} {r['到站時段']}：第一台要排 {r['第一台要排%']}%，要排時最晚多等中位數 {r['要排時最晚多等（中位數，分）']} 分、"
              f"最多 {r['要排時最晚多等（最多，分）']} 分；建議預留 {r['建議預留（分）']} 分（{r['分鐘數']} 分鐘）")
    print(f"已寫入 {tpath}")
    path = os.path.join(a.out, f"557尖峰排隊預測成績_{a.days[-1]}.csv")
    p.write_csv(path, rows, list(rows[0].keys()),
                "# 尖峰排隊預測：國中（連續紅色前 k−1 台要排）、士林站（團隊顏色規則）。實際：第一台不用排就搭它；要排 → 最快下一台、最晚第一台不用排的車")
    print(f"已寫入 {path}")


if __name__ == "__main__":
    main()
