# /// script
# dependencies = ["openpyxl", "scikit-learn", "numpy"]
# ///
"""557 尖峰到校時間範圍：尖峰不准只推「搭第一班」的時間，要把「要排隊、等下一台」的時間差算進去，給一個明確的範圍。

實際答案也是範圍：學生搭的車介在「第一班」和「第一班不用排的車」之間（網站看不到他排第幾個）。
好的範圍要：下限不晚於第一班（差 3 分內）、上限不早於第一班不用排的車（差 3 分內），而且越窄越好。

比較的範圍算法（車幾點到都用零件模型模擬）：
  A. 第一班 ～ 第二班
  B. 第一班 ～ 第一班＋歷史同時段「等到不用排的車」多花的時間（P80）
  C. 第一班 ～ 第二班＋歷史多花時間扣掉一班（第二班之後還可能要等）
  D. 只推第一班的 P20 ～ P80（舊做法，沒算排隊）
  E. Bot：一律 12 分＋尖峰 10 分（只有一個時間）

  uv run tools/尖峰範圍557.py
"""
import argparse
import os
import sys
from datetime import timedelta

import numpy as np

import importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("queue557", os.path.join(HERE, "排隊模擬557.py"))
Q = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(Q)
Z, L, p = Q.Z, Q.L, Q.p

TOL = 3           # 差幾分以內算對
GAP_WINDOW = 15   # 歷史多花時間用前後幾分鐘
START, END = "07:00", "10:30"


def truth(rows, go):
    """(第一班到東吳, 第一班不用排的車到東吳)；45 分鐘內沒有就 None"""
    first = next((r for r in rows if r["a"] >= go), None)
    clear = next((r for r in rows if r["a"] >= go and not r["full"]), None)
    if not first or not clear or first["a"] - go > p.MAX_WAIT or clear["a"] - go > p.MAX_WAIT:
        return None
    return first["東吳"], clear["東吳"]


def gap_samples(rows_by_day):
    """訓練那幾天尖峰每一分鐘：(幾點到站, 等到不用排的車比第一班晚幾分)"""
    out = []
    for day, rows in rows_by_day.items():
        t = p.on_day(START, day)
        while t <= p.on_day(END, day):
            if Z.in_out_peak(t):
                tr = truth(rows, t)
                if tr:
                    out.append((L.tod(t), (tr[1] - tr[0]).total_seconds() / 60))
            t += timedelta(minutes=1)
    return np.array(out) if out else np.zeros((0, 2))


def extra(gaps, tod, q=80):
    near = gaps[np.abs(gaps[:, 0] - tod) <= GAP_WINDOW, 1] if len(gaps) else []
    return float(np.percentile(near, q)) if len(near) else 10.0


def pick_kth(sims_out, n, k, fallback):
    """每次模擬挑 n 分鐘後第 k 台（1 = 第一班）到士林站的車，回傳到東吳的分鐘數"""
    if not sims_out:
        return np.full(Z.SIMS, float(fallback))
    M = np.stack([m for m, _ in sims_out])
    S = np.stack([s for _, s in sims_out])
    M = np.where(M >= n, M, np.inf)
    order = np.argsort(M, axis=0)
    if order.shape[0] < k:
        return np.full(M.shape[1], float(fallback))
    idx = order[k - 1]
    cols = np.arange(M.shape[1])
    ok = np.isfinite(M[idx, cols]) & (M[idx, cols] - n <= p.MAX_WAIT.total_seconds() / 60)
    return np.where(ok, S[idx, cols], fallback)


def exam(days, tests, data_dir=p.DATA_DIR, seed=0):
    """回傳 {(n, 方法): {考卷: [(下限對, 上限對, 寬度, 第一班要排)]}}"""
    rng = np.random.default_rng(seed)
    buses = {d: p.load_day(d, data_dir) for d in days}
    events = {d: L.load_events(d, data_dir) for d in days}
    vis = {d: {v: Z.visits(xs) for v, xs in events[d].items()} for d in days}
    segs = {d: Z.segments(vis[d], buses[d]) for d in days}
    rows = {d: [r for r in Q.bus_rows(L.load_trips(d, data_dir), buses[d]) if r["東吳"]] for d in days}
    out = {}
    for test in tests:
        train = [d for d in days if d != test]
        table = Z.Table([s for d in train for s in segs[d]])
        gaps = gap_samples({d: rows[d] for d in train})
        rx, ry = L.ride_samples([b for d in train for b in buses[d]])
        ride_model = L.gbr().fit(rx, ry)
        t, end = p.on_day(START, test) - timedelta(minutes=max(L.AHEAD)), p.on_day(END, test)
        while t <= end:
            sims_out = None
            for n in L.AHEAD:
                go = t + timedelta(minutes=n)
                if not Z.in_out_peak(go):
                    continue
                tr = truth(rows[test], go)
                if not tr or not p.seen(buses[test], t, tr[0]):
                    continue
                if sims_out is None:
                    sims_out = Z.simulate(vis[test], t, table, Z.today_factor(segs[test], t, table), rng)
                hw = Z.hist_wait(buses, train, go)
                hist = go + timedelta(minutes=hw)
                v0 = hist + timedelta(minutes=float(ride_model.predict([[L.tod(hist), hist.weekday()]])[0]))
                fb = (v0 - t).total_seconds() / 60
                first = pick_kth(sims_out, n, 1, fb)
                second = pick_kth(sims_out, n, 2, fb + 2 * hw)
                at = lambda m: t + timedelta(minutes=float(m))
                f50, s50 = np.median(first), np.median(second)
                ex = extra(gaps, L.tod(go))
                # 第二班到東吳和第一班差多少，歷史多花時間扣掉這段，剩下的是「第二班也可能要排」
                ranges = {
                    "A 第一班～第二班": (at(f50), at(s50)),
                    "B 第一班～第一班＋歷史多花（P80）": (at(f50), at(f50 + ex)),
                    "C 第一班～第二班或歷史多花取晚的": (at(f50), at(max(s50, f50 + ex))),
                    "D 只推第一班 P20～P80（沒算排隊）": (at(np.percentile(first, 20)), at(np.percentile(first, 80))),
                    "E Bot 現行（12 分＋尖峰 10 分）": (p.bot_estimate(go), p.bot_estimate(go)),
                }
                lo, hi = tr
                queued = hi > lo
                for k, (a, b) in ranges.items():
                    v = (float(a <= lo + timedelta(minutes=TOL)), float(b >= hi - timedelta(minutes=TOL)),
                         (b - a).total_seconds() / 60, queued)
                    out.setdefault((n, k), {}).setdefault(test, []).append(v)
            t += timedelta(minutes=1)
        print(f"{test} 考完", file=sys.stderr)
    return out


def summarize(out):
    rows = []
    for (n, k), by_day in sorted(out.items()):
        for day in ["全部"] + sorted(by_day):
            xs = [v for d, es in by_day.items() if day in ("全部", d) for v in es]
            a = np.array([x[:3] for x in xs])
            qd = np.array([x[1] for x in xs if x[3]])
            rows.append({"情況": f"提早 {n} 分鐘查", "方法": k, "考卷": day if day == "全部" else day[5:],
                         "下限對%": round(100 * a[:, 0].mean()), "上限對%": round(100 * a[:, 1].mean()),
                         "都對%": round(100 * (a[:, 0] * a[:, 1]).mean()),
                         "第一班要排時上限對%": round(100 * qd.mean()) if len(qd) else "",
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
            print(f"{r['情況']} | {r['方法']}：下限對 {r['下限對%']}%、上限對 {r['上限對%']}%（第一班要排時 {r['第一班要排時上限對%']}%）、"
                  f"都對 {r['都對%']}%、寬 {r['平均寬度（分）']} 分（{r['筆數']} 筆）")
    path = os.path.join(a.out, f"557尖峰範圍成績_{a.days[-1]}.csv")
    p.write_csv(path, rows, list(rows[0].keys()),
                f"# 往東吳尖峰（07:30–08:00、09:15–10:00）到校時間範圍。實際：第一班 ～ 第一班不用排的車；差 {TOL} 分內算對")
    print(f"已寫入 {path}")


if __name__ == "__main__":
    main()
