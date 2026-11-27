# /// script
# dependencies = ["openpyxl", "scikit-learn", "numpy"]
# ///
"""557 回程排隊預測：學生 N 分鐘後到東吳站牌，要等第幾台、幾點到捷運士林站（11/28）

「要排」的車（團隊 11/28 定）：離開東吳 59 人以上算擠；連續 k 台都 59 人以上，前 k−1 台要排，最後一台把隊伍載完。
  （回程紅色門檻約 45–50 人，尖峰常常連續 5–13 台紅色，只看顏色會變成要等一個多小時，所以改用人數）

實際答案（範圍）：學生到站後，第一台不用排就搭它；第一台要排 → 最快搭下一台，最晚搭第一台不用排的車

幾點到士林站（團隊建議）：預測幾點從東吳發車（零件模型模擬每台車），再加上那個時段東吳 → 士林站的車程
  （訓練那幾天、前後 20 分鐘的中位數）。也跟零件模型直接模擬到士林站比

範圍 = 第一台 ～（第二台、第一台＋歷史同時段最晚多等的 P80）取晚的

  uv run tools/回程排隊預測557.py
"""
import argparse
import os
import statistics
import sys
from datetime import timedelta

import numpy as np

import importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("parts557", os.path.join(HERE, "零件模型557.py"))
Z = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(Z)
L, p, mon = Z.L, Z.p, Z.mon

FULL = 59           # 離開東吳幾人以上算擠
TOL = 3
ANALOG = 10
RIDE_WINDOW = 20


def return_rows(day, data_dir=p.DATA_DIR):
    """一天的回程：每台 (離開東吳, 到捷運士林站, 離開東吳人數)，再標「要排」"""
    ev = mon.load_csv(os.path.join(data_dir, f"557_raw_{day}.csv"), mon.event_key)
    cr = mon.fresh(mon.load_csv(os.path.join(data_dir, f"557_人數_{day}.csv"), mon.crowd_key))
    rows = []
    for t in mon.build_returns(ev, cr):
        if not t["參考"]:
            continue
        cnt = int(t["東吳人數"]["車上人數"]) if t.get("東吳人數") and not t.get("人數不可信") else None
        rows.append({"dep": t["參考"], "arr": t["時間"].get(mon.R_MRT), "cnt": cnt})
    return label(sorted(rows, key=lambda r: r["dep"]))


def label(rows):
    """連續擠（59 人以上）k 台：前 k−1 台要排"""
    full = [r["cnt"] is not None and r["cnt"] >= FULL for r in rows]
    for i, r in enumerate(rows):
        r["q"] = full[i] and i + 1 < len(rows) and full[i + 1]
    return rows


def truth(rows, go):
    """(第一台到士林站, 最快, 最晚)；要用到的車沒有到士林站時間、或 45 分鐘內沒有 → None"""
    seq = [r for r in rows if r["dep"] >= go]
    if not seq or seq[0]["dep"] - go > p.MAX_WAIT:
        return None
    first = seq[0]
    if not first["q"]:
        return (first["arr"],) * 3 if first["arr"] else None
    clear = next((r for r in seq if not r["q"]), None)
    if len(seq) < 2 or not clear or clear["dep"] - go > p.MAX_WAIT or not (first["arr"] and seq[1]["arr"] and clear["arr"]):
        return None
    return first["arr"], seq[1]["arr"], clear["arr"]


def ride_table(rows_by_day):
    """訓練那幾天每台 (離開東吳的時刻, 東吳 → 士林站幾分)"""
    return np.array([(L.tod(r["dep"]), (r["arr"] - r["dep"]).total_seconds() / 60)
                     for rows in rows_by_day.values() for r in rows if r["arr"]], float)


def ride_at(table, tod):
    near = table[np.abs(table[:, 0] - tod) <= RIDE_WINDOW, 1] if len(table) else []
    return float(np.median(near)) if len(near) else (float(np.median(table[:, 1])) if len(table) else 8.0)


def history(rows_by_day, start="07:00", end="18:30"):
    """訓練那幾天每一分鐘：(幾點到站牌, 最快多等, 最晚多等)"""
    out = []
    for day, rows in rows_by_day.items():
        go = p.on_day(start, day)
        while go <= p.on_day(end, day):
            tr = truth(rows, go)
            if tr:
                f, lo, hi = tr
                out.append((L.tod(go), (lo - f).total_seconds() / 60, (hi - f).total_seconds() / 60))
            go += timedelta(minutes=1)
    return np.array(out, float) if out else np.zeros((0, 3))


def late_extra(hist, tod):
    near = hist[np.abs(hist[:, 0] - tod) <= ANALOG, 2] if len(hist) else []
    return float(np.percentile(near, 80)) if len(near) else 10.0


def kth_departure(sims_out, n, k, fallback):
    """每次模擬：n 分鐘後第 k 台離開東吳的車 → (離開東吳分鐘, 零件模型模擬到士林站分鐘)"""
    if not sims_out:
        return np.full(Z.SIMS, float(fallback)), np.full(Z.SIMS, np.nan)
    D = np.stack([d for d, _ in sims_out])
    A = np.stack([a for _, a in sims_out])
    D = np.where(D >= n, D, np.inf)
    if D.shape[0] < k:
        return np.full(D.shape[1], float(fallback)), np.full(D.shape[1], np.nan)
    idx = np.argsort(D, axis=0)[k - 1]
    cols = np.arange(D.shape[1])
    ok = np.isfinite(D[idx, cols]) & (D[idx, cols] - n <= p.MAX_WAIT.total_seconds() / 60)
    return np.where(ok, D[idx, cols], fallback), np.where(ok, A[idx, cols], np.nan)


def exam(days, tests, data_dir=p.DATA_DIR, seed=0):
    """回傳 ({(n, 方法): {考卷: [(下限對, 上限對, 寬度, 第一台要排, 回程尖峰)]}}, {(n, 方法): {考卷: [(誤差, 尖峰)]}})"""
    rng = np.random.default_rng(seed)
    buses = {d: p.load_day(d, data_dir) for d in days}
    events = {d: L.load_events(d, data_dir) for d in days}
    vis = {d: {v: Z.visits(xs) for v, xs in events[d].items()} for d in days}
    segs = {d: Z.segments(vis[d], buses[d]) for d in days}
    rows = {d: return_rows(d, data_dir) for d in days}
    rets = {d: [(r["dep"], r["arr"]) for r in rows[d] if r["arr"]] for d in days}
    rng_out, pt_out = {}, {}
    for test in tests:
        train = [d for d in days if d != test]
        table = Z.Table([s for d in train for s in segs[d]])
        rides = ride_table({d: rows[d] for d in train})
        hist = history({d: rows[d] for d in train})
        t, end = p.on_day(p.DAY_START, test), p.on_day(p.DAY_END, test)
        while t <= end:
            sims_out = None
            for n in L.AHEAD:
                go = t + timedelta(minutes=n)
                tr = truth(rows[test], go)
                first_dep = next((r["dep"] for r in rows[test] if r["dep"] >= go), None)
                if not tr or not p.seen(buses[test], t, first_dep):
                    continue
                if sims_out is None:
                    sims_out = Z.simulate(vis[test], t, table, Z.today_factor(segs[test], t, table), rng,
                                          board=Z.R_BOARD, alight=Z.R_ALIGHT)
                v0 = Z.return_v0(rets, train, go, buses)
                fb_dep = n + 8.0
                d1, a1 = kth_departure(sims_out, n, 1, fb_dep)
                d2, _ = kth_departure(sims_out, n, 2, fb_dep + 10)
                at = lambda m: t + timedelta(minutes=float(m))
                dep1 = float(np.median(d1))
                f_ride = dep1 + ride_at(rides, L.tod(at(dep1)))          # 發車＋時段車程
                s_ride = float(np.median(d2)) + ride_at(rides, L.tod(at(float(np.median(d2)))))
                a1 = np.where(np.isnan(a1), d1 + ride_at(rides, L.tod(go)), a1)
                f_sim = float(np.median(a1))                              # 零件模型直接模擬到士林站
                f_real, lo, hi = tr
                peak = Z.in_return_peak(go)
                for k, pr in (("Bot 現行", p.bot_estimate(go)), ("v0 歷史", v0),
                              ("零件模型（模擬到士林站）", at(f_sim)), ("發車＋時段車程", at(f_ride))):
                    if pr:
                        pt_out.setdefault((n, k), {}).setdefault(test, []).append(((pr - f_real).total_seconds() / 60, peak))
                ex = late_extra(hist, L.tod(go))
                ranges = {
                    "只推第一台（零件模型 P20～P80，沒算排隊）": (at(np.nanpercentile(a1, 20)), at(np.nanpercentile(a1, 80))),
                    "排隊範圍（發車＋時段車程）": (at(f_ride), at(max(s_ride, f_ride + ex))),
                }
                for k, (a, b) in ranges.items():
                    v = (float(a <= lo + timedelta(minutes=TOL)), float(b >= hi - timedelta(minutes=TOL)),
                         (b - a).total_seconds() / 60, hi > f_real, peak)
                    rng_out.setdefault((n, k), {}).setdefault(test, []).append(v)
            t += timedelta(minutes=1)
        print(f"{test} 考完", file=sys.stderr)
    return rng_out, pt_out


def slot_table(rows_by_day):
    h = history(rows_by_day, "11:00", "19:00")
    out = []
    for s in range(11 * 60, 19 * 60, 15):
        x = h[(h[:, 0] >= s) & (h[:, 0] < s + 15)]
        if not len(x):
            continue
        q = x[x[:, 2] > 0]
        out.append({"到東吳站牌": f"{s // 60:02d}:{s % 60:02d}–{(s + 15) // 60:02d}:{(s + 15) % 60:02d}",
                    "第一台要排%": round(100 * len(q) / len(x)),
                    "要排時最晚多等（中位數，分）": round(float(np.median(q[:, 2])), 1) if len(q) else "",
                    "要排時最晚多等（最多，分）": round(float(q[:, 2].max()), 1) if len(q) else "",
                    "建議預留（分）": round(float(np.percentile(x[:, 2], 80))), "分鐘數": len(x)})
    return out


def summarize(rng_out, pt_out):
    rows = []
    for scope, keep in (("全天", lambda pk: True), ("回程尖峰（12:00–13:30、15:00–16:00、17:00–18:30）", lambda pk: pk)):
        for (n, k), by_day in sorted(pt_out.items()):
            xs = [e for es in by_day.values() for e, pk in es if keep(pk)]
            if xs:
                a = np.abs(xs)
                rows.append({"範圍": scope, "情況": "人已經在站牌" if n == 0 else f"{n} 分鐘後到站牌", "方法": k,
                             "成績": f"第一台：平均差 {a.mean():.2f} 分，±3 分內 {100 * np.mean(a <= 3):.0f}%", "筆數": len(xs)})
        for (n, k), by_day in sorted(rng_out.items()):
            xs = [v for es in by_day.values() for v in es if keep(v[4])]
            if not xs:
                continue
            a = np.array([x[:3] for x in xs])
            qd = [x[1] for x in xs if x[3]]
            rows.append({"範圍": scope, "情況": "人已經在站牌" if n == 0 else f"{n} 分鐘後到站牌", "方法": k,
                         "成績": f"最晚沒少算 {100 * a[:, 1].mean():.0f}%（第一台要排 {100 * np.mean([x[3] for x in xs]):.0f}% 的時候 "
                                 f"{100 * np.mean(qd):.0f}%）、最早沒太晚 {100 * a[:, 0].mean():.0f}%、寬 {a[:, 2].mean():.1f} 分"
                                 if qd else f"最晚沒少算 {100 * a[:, 1].mean():.0f}%、最早沒太晚 {100 * a[:, 0].mean():.0f}%、寬 {a[:, 2].mean():.1f} 分",
                         "筆數": len(xs)})
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
    data = {d: return_rows(d, a.data) for d in a.days}
    table = slot_table(data)
    tpath = os.path.join(a.out, f"557回程排隊時段表_{a.days[-1]}.csv")
    p.write_csv(tpath, table, list(table[0].keys()), f"# 回程：離開東吳 {FULL} 人以上連續 k 台，前 k−1 台要排。四天全部資料")
    for r in table:
        print(f"{r['到東吳站牌']}：第一台要排 {r['第一台要排%']}%，要排時最晚多等中位數 {r['要排時最晚多等（中位數，分）']} 分、"
              f"最多 {r['要排時最晚多等（最多，分）']} 分；建議預留 {r['建議預留（分）']} 分（{r['分鐘數']} 分鐘）")
    rows = summarize(*exam(a.days, a.days, a.data))
    for r in rows:
        print(f"{r['範圍']} | {r['情況']} | {r['方法']}：{r['成績']}（{r['筆數']} 筆）")
    path = os.path.join(a.out, f"557回程排隊預測成績_{a.days[-1]}.csv")
    p.write_csv(path, rows, list(rows[0].keys()), f"# 回程排隊預測（{FULL} 人規則）。實際：第一台不用排就搭它；要排 → 最快下一台、最晚第一台不用排的車")
    print(f"已寫入 {tpath}、{path}")


if __name__ == "__main__":
    main()
