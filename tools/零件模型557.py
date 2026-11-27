# /// script
# dependencies = ["openpyxl", "scikit-learn", "numpy"]
# ///
"""557 零件模型：把公車系統拆成幾個從資料學的零件，再模擬很多次，預測「在家提早 N 分鐘查，幾點到東吳」

零件：
  1. 分段車程：路線切成「這站 → 下一站」，每一段依時段（前後 20 分鐘）從訓練那幾天學開車時間的分布。
     回程最後一站 → 去程第一站這段含「在總站停多久」（中位數約 4 分，有時近 30 分）
  2. 車現在在哪：每台車最後一次回報在哪一站、已經停多久。已經停了 e 分鐘，就只從「超過 e 分鐘」的
     樣本抽剩下的時間（在總站已經停很久的車，快發車了）。停超過那一段最長紀錄 5 分鐘以上的車
     當作退出營運或 GPS 斷了，不算
  3. 今天路況：最近 30 分鐘跑完的路段，實際 ÷ 平常 的中位數（樣本少就往 1 拉），乘在之後每一段
  4. 模擬：每台車沿路線抽 200 次，算出每次「下一次到士林站」「接著到東吳」的時間；學生 N 分鐘後到站，
     每次模擬挑那之後第一台車，取到東吳時間的中位數當預測，第 20、80 百分位當範圍
  沒有車在 45 分鐘內會來（還沒出車）就用 v0 的歷史等車

結合：提早 10 分鐘以上，零件模型和 v0 統計取平均（四天考試裡最準）

  uv run tools/零件模型557.py
"""
import argparse
import math
import os
import statistics
import sys
from datetime import datetime, timedelta

import numpy as np

import importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("learn557", os.path.join(HERE, "學習557.py"))
L = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(L)
p, mon = L.p, L.mon

C = len(L.POS)
MRT = L.MRT_POS
SCHOOL = L.POS[(0, mon.SCHOOL)]
LAYOVER = len(mon.R_ROUTE) - 1  # 回程最後一站 → 去程第一站（含在總站停車）
DWELL = C - 1                    # 東吳（去程終點）→ 錢穆故居（回程第一站）：在校內停車
NO_TRAFFIC = (LAYOVER, DWELL)    # 停車的段不乘今天路況
SIMS = 200
SEG_WINDOW = 20                  # 分段車程用前後幾分鐘的樣本
LOOK = 30                        # 今天路況看最近幾分鐘
SHRINK = 8                       # 今天路況的樣本少於這個數，就往 1 拉一半以上
BLEND_FROM = 10                  # 提早幾分鐘以上，零件模型和 v0 取平均


def visits(xs):
    """同一站連續幾筆（到站、離站）只留第一筆 → 每次到這一站的時間"""
    out = []
    for t, pos in xs:
        if not out or out[-1][1] != pos:
            out.append((t, pos))
    return out


def segments(vis, day_buses):
    """所有「這站 → 下一站」花幾分鐘：[(起點位置, 出發時刻 tod, 分鐘, 抵達時間)]。
    GPS 漏站（跳過一站）的不算；監測斷掉的時段不算"""
    out = []
    for xs in vis.values():
        for (t1, p1), (t2, p2) in zip(xs, xs[1:]):
            if p2 == (p1 + 1) % C:
                dt = (t2 - t1).total_seconds() / 60
                if 0 < dt <= 90 and p.seen(day_buses, t1, t2):
                    out.append((p1, L.tod(t1), dt, t2))
    return out


class Table:
    """訓練那幾天的分段車程：pool(段, 時刻) = 前後 SEG_WINDOW 分鐘內的樣本（太少就用整天）"""

    def __init__(self, segs):
        by = {}
        for p1, td, dt, _ in segs:
            by.setdefault(p1, []).append((td, dt))
        self.arr = {k: (np.array([a for a, _ in v]), np.array([b for _, b in v])) for k, v in by.items()}
        self.cache = {}

    def pool(self, seg, td):
        key = (seg, int(td // 5))
        if key not in self.cache:
            if seg not in self.arr:
                self.cache[key] = np.array([1.0])
            else:
                tds, dts = self.arr[seg]
                m = np.abs(tds - td) <= SEG_WINDOW
                self.cache[key] = dts[m] if m.sum() >= 5 else dts
        return self.cache[key]

    def median(self, seg, td):
        return float(np.median(self.pool(seg, td)))


def today_factor(today_segs, t, table):
    """今天最近 LOOK 分鐘內跑完的路段（不含停車的段）：實際 ÷ 平常 的中位數，樣本少就往 1 拉，限制在 0.75–1.5 倍"""
    lo = t - timedelta(minutes=LOOK)
    r = [math.log(dt / table.median(p1, td)) for p1, td, dt, t2 in today_segs if lo <= t2 <= t and p1 not in NO_TRAFFIC]
    if not r:
        return 1.0
    w = len(r) / (len(r) + SHRINK)
    return float(np.clip(math.exp(w * statistics.median(r)), 0.75, 1.5))


def simulate(vis, t, table, factor, rng, sims=SIMS):
    """路上每台車模擬 sims 次：[(下一次到士林站幾分鐘後, 接著到東吳幾分鐘後)]，都從 t 算起"""
    out = []
    for xs in vis.values():
        last = None
        for x in xs:
            if x[0] > t:
                break
            last = x
        if not last:
            continue
        t0, pos = last
        el = (t - t0).total_seconds() / 60
        cur = table.pool(pos, L.tod(t0))
        if el > cur.max() + 5 or el > 60:
            continue  # 早就該到下一站了：多半退出營運或 GPS 斷了
        left = cur[cur > el]
        tot = ((rng.choice(left, sims) if len(left) else np.full(sims, el + 0.5)) - el) * (factor if pos not in NO_TRAFFIC else 1.0)
        q, clock, mrt = (pos + 1) % C, L.tod(t), None
        for _ in range(2 * C):
            if q == MRT and mrt is None:
                mrt = tot.copy()
            if q == SCHOOL and mrt is not None:
                out.append((mrt, tot.copy()))
                break
            f = factor if q not in NO_TRAFFIC else 1.0
            tot = tot + rng.choice(table.pool(q, clock + float(np.median(tot))), sims) * f
            q = (q + 1) % C
    return out


def pick(sims_out, n, fallback, sims=SIMS):
    """每次模擬挑「n 分鐘後之後、45 分鐘內第一台到士林站的車」，回傳到東吳的分鐘數（每次模擬一個）。
    沒有車就用 fallback（v0 歷史等車＋車程）"""
    if not sims_out:
        return np.full(sims, fallback)
    M = np.stack([m for m, _ in sims_out])
    S = np.stack([s for _, s in sims_out])
    ok = (M >= n) & (M <= n + p.MAX_WAIT.total_seconds() / 60)
    idx = np.where(ok, M, np.inf).argmin(axis=0)
    return np.where(ok.any(axis=0), S[idx, np.arange(M.shape[1])], fallback)


def hist_wait(buses, train, go):
    ws = []
    for d in train:
        at = p.on_day(go.strftime("%H:%M"), d)
        if p.covers(buses[d], "士林站", at):
            ws += p.wait_samples(buses[d], "士林站", at, -999, p.WINDOW)
    return statistics.median(ws) if ws else 8


def exam(days, tests, data_dir=p.DATA_DIR, seed=0):
    """四天輪流考試：每一分鐘、每個提早幾分鐘，各方法預測幾點到東吳 vs 實際。回傳 {(n, 方法): {考卷: [誤差]}}"""
    rng = np.random.default_rng(seed)
    buses = {d: p.load_day(d, data_dir) for d in days}
    events = {d: L.load_events(d, data_dir) for d in days}
    arrivals = {d: L.mrt_arrivals(events[d]) for d in days}
    vis = {d: {v: visits(xs) for v, xs in events[d].items()} for d in days}
    segs = {d: segments(vis[d], buses[d]) for d in days}
    out = {}

    def add(n, k, test, v):
        out.setdefault((n, k), {}).setdefault(test, []).append(v)
    for test in tests:
        train = [d for d in days if d != test]
        table = Table([s for d in train for s in segs[d]])
        X, y = [], []
        for d in train:
            a, b = L.position_samples(events[d], arrivals[d], buses[d], p.on_day("06:40", d), p.on_day("18:40", d))
            X += a
            y += b
        pos_model = L.gbr(max_iter=300, max_depth=4, min_samples_leaf=20).fit(X, y)
        rx, ry = L.ride_samples([b for d in train for b in buses[d]])
        ride_model = L.gbr().fit(rx, ry)
        ride = {}

        def arrive(at):
            if at not in ride:
                ride[at] = at + timedelta(minutes=float(ride_model.predict([[L.tod(at), at.weekday()]])[0]))
            return ride[at]
        tb = buses[test]
        mrt = sorted((b["到站"]["士林站"], b) for b in tb if "士林站" in b["到站"])
        etas = L.load_site_etas(test, data_dir)
        t, end = p.on_day(p.DAY_START, test), p.on_day(p.DAY_END, test)
        while t <= end:
            sims_out = simulate(vis[test], t, table, today_factor(segs[test], t, table), rng)
            lasts = [s for s in (L.state(xs, t) for xs in events[test].values()) if s]
            coming = sorted(t + timedelta(minutes=float(m)) for m in pos_model.predict([L.position_features(t, s) for s in lasts])) if lasts else []
            site = L.site_next(etas, t)
            for n in L.AHEAD:
                go = t + timedelta(minutes=n)
                act = next((b for a, b in mrt if a >= go), None)
                if not act or act["到站"]["士林站"] - go > p.MAX_WAIT or not p.seen(tb, t, act["到站"]["士林站"]):
                    continue
                real = act["東吳"]
                hist = go + timedelta(minutes=hist_wait(buses, train, go))
                v0 = arrive(hist)
                ml = arrive(next((c for c in coming if c >= go and c - go <= p.MAX_WAIT), hist))
                web = arrive(site if site and site >= go else hist)
                school = pick(sims_out, n, (v0 - t).total_seconds() / 60)
                part = t + timedelta(minutes=float(np.median(school)))
                both = part + (v0 - part) / 2 if n >= BLEND_FROM else part
                for k, pr in (("Bot 現行", p.bot_estimate(go)), ("v0 歷史", v0), ("網站下一班", web), ("機器學習（車輛位置）", ml),
                              ("零件模型", part), ("結合（零件＋v0，提早 10 分鐘以上才平均）", both),
                              ("平均（零件＋車輛位置 ML）", part + (ml - part) / 2)):
                    add(n, k, test, (pr - real).total_seconds() / 60)
                add(n, "零件模型 P80 涵蓋", test, float(real <= t + timedelta(minutes=float(np.percentile(school, 80)))))
                add(n, "零件模型 P20–P80 涵蓋", test, float(t + timedelta(minutes=float(np.percentile(school, 20))) <= real
                                                       <= t + timedelta(minutes=float(np.percentile(school, 80)))))
            t += timedelta(minutes=1)
        print(f"{test} 考完", file=sys.stderr)
    return out


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
    out = exam(a.days, a.days, a.data)
    rows = []
    for (n, k), by_day in out.items():
        for exam_day in ["全部"] + list(by_day):
            e = [x for v in by_day.values() for x in v] if exam_day == "全部" else by_day[exam_day]
            if "涵蓋" in k:
                row = {"平均差": "", "容許內%": round(100 * sum(e) / len(e)), "容許": "目標 60%" if "P20" in k else "目標 80%"}
            else:
                row = {"平均差": round(statistics.mean(map(abs, e)), 2), "容許內%": round(100 * sum(abs(x) <= 3 for x in e) / len(e)), "容許": "±3 分"}
            rows.append({"情況": f"提早 {n} 分鐘查", "方法": k, "考卷": exam_day if exam_day == "全部" else exam_day[5:], **row, "筆數": len(e)})
    path = os.path.join(a.out, f"557零件模型成績_{a.days[-1]}.csv")
    p.write_csv(path, rows, ["情況", "方法", "考卷", "平均差", "容許", "容許內%", "筆數"],
                f"# 在家預估幾點到東吳，{'、'.join(d[5:] for d in a.days)} 輪流當考卷（11/24 只有傍晚）；產生時間 {datetime.now():%Y-%m-%d %H:%M}")
    for r in rows:
        if r["考卷"] == "全部":
            per = "  ".join(f"{x['考卷']} {x['平均差'] if x['平均差'] != '' else str(x['容許內%']) + '%'}" for x in rows
                            if x["考卷"] != "全部" and (x["情況"], x["方法"]) == (r["情況"], r["方法"]))
            v = f"平均差 {r['平均差']} 分，±3 分內 {r['容許內%']}%" if r["平均差"] != "" else f"{r['容許內%']}%（{r['容許']}）"
            print(f"{r['情況']} | {r['方法']}：{v}  [{per}]")
    print(f"已寫入 {path}")


if __name__ == "__main__":
    main()
