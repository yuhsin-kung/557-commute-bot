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

回程（東吳 → 捷運士林站，11/28）：同一套零件，上車站改成「離開東吳」（錢穆故居）、下車站改成回程的捷運士林站。
  提早 20 分鐘以內用零件模型，20 分鐘以上和 v0 平均

  uv run tools/零件模型557.py                    去程、回程都考
  uv run tools/零件模型557.py --direction 回程
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


def simulate(vis, t, table, factor, rng, sims=SIMS, board=MRT, alight=SCHOOL):
    """路上每台車模擬 sims 次：[(下一次到上車站 board 幾分鐘後, 接著到下車站 alight 幾分鐘後)]，都從 t 算起。
    預設是去程（士林站上車、東吳下車）；回程用 board=錢穆故居（離開東吳）、alight=捷運士林站（回程）"""
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
            if q == board and mrt is None:
                mrt = tot.copy()
            if q == alight and mrt is not None:
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


OUT_PEAKS = ((450, 480), (555, 600))  # 往東吳尖峰：07:30–08:00、09:15–10:00（11/28 用「要排隊」規則定的）
QUEUE_FULL = 60                        # 離開士林站 60 人以上（實測約 64–66 人就滿）


def in_out_peak(go):
    return any(a <= go.hour * 60 + go.minute < b for a, b in OUT_PEAKS)


def must_queue(trip):
    """這班到士林站「要排隊、可能上不去」嗎（11/28 團隊定的顏色規則）：
    離開士林國中紅 → 要排；離開士林站綠／黃 → 不用；國中綠／黃、士林站紅 → 離開士林站 60 人以上才要排。
    人數被清掉或沒有人數 → None（不知道，當作上得去）"""
    if trip.get("人數不可信") or not trip.get("士林站人數"):
        return None
    jhs, mrt = trip.get("國中人數"), trip["士林站人數"]
    if jhs and int(jhs["擁擠等級"]) == 3:
        return True
    if int(mrt["擁擠等級"]) < 3:
        return False
    return int(mrt["車上人數"]) >= QUEUE_FULL


def exam(days, tests, data_dir=p.DATA_DIR, seed=0):
    """四天輪流考試：每一分鐘、每個提早幾分鐘，各方法預測幾點到東吳 vs 實際。
    回傳 {(n, 方法): {考卷: [(誤差：搭第一班, 誤差：第一班要排就等下一班, 是不是尖峰)]}}"""
    rng = np.random.default_rng(seed)
    buses = {d: p.load_day(d, data_dir) for d in days}
    events = {d: L.load_events(d, data_dir) for d in days}
    arrivals = {d: L.mrt_arrivals(events[d]) for d in days}
    vis = {d: {v: visits(xs) for v, xs in events[d].items()} for d in days}
    segs = {d: segments(vis[d], buses[d]) for d in days}
    queue = {d: {(t["車輛ID"], t["參考"]): must_queue(t) for t in L.load_trips(d, data_dir) if t["參考"]} for d in days}
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
                # 照排隊規則：第一班要排就當作上不去，等下一班（沒人數的當作上得去）
                okb = next((b for a, b in mrt if a >= go and not queue[test].get((b["車輛ID"], a))), None)
                real_q = okb["東吳"] if okb and okb["到站"]["士林站"] - go <= p.MAX_WAIT else None
                peak = in_out_peak(go)
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
                    add(n, k, test, ((pr - real).total_seconds() / 60,
                                     (pr - real_q).total_seconds() / 60 if real_q else None, peak))
                p20 = t + timedelta(minutes=float(np.percentile(school, 20)))
                p80 = t + timedelta(minutes=float(np.percentile(school, 80)))
                add(n, "零件模型 P80 涵蓋", test, (float(real <= p80), float(real_q <= p80) if real_q else None, peak))
                add(n, "零件模型 P20–P80 涵蓋", test, (float(p20 <= real <= p80), float(p20 <= real_q <= p80) if real_q else None, peak))
                add(n, "第一班要排（比例）", test, (float(real_q is not None and real_q != real), None, peak))
            t += timedelta(minutes=1)
        print(f"{test} 考完", file=sys.stderr)
    return out


R_BOARD = L.POS[(1, mon.R_QIAN)]   # 回程上車：離開東吳（到錢穆故居）
R_ALIGHT = L.POS[(1, mon.R_MRT)]   # 回程下車：捷運士林站
R_PEAKS = ((720, 810), (900, 960), (1020, 1110))  # 回程尖峰：12:00–13:30、15:00–16:00、17:00–18:30（11/28 用資料找的）


def returns(day, data_dir=p.DATA_DIR):
    """一天的回程：[(離開東吳, 到捷運士林站)]。離開東吳用回程表的時間（GPS 漏記錢穆故居就用後面的站往回推）"""
    ev = mon.load_csv(os.path.join(data_dir, f"557_raw_{day}.csv"), mon.event_key)
    cr = mon.fresh(mon.load_csv(os.path.join(data_dir, f"557_人數_{day}.csv"), mon.crowd_key))
    return sorted((t["參考"], t["時間"][mon.R_MRT]) for t in mon.build_returns(ev, cr) if t["參考"] and mon.R_MRT in t["時間"])


def return_v0(rets, train, go, day_buses):
    """回程 v0：訓練那幾天 go 前後 10 分鐘每一分鐘到東吳，等下一班離開東吳要幾分鐘（中位數）；
    車程：那個時間前後 10 分鐘離開的車，東吳 → 捷運士林站幾分鐘（中位數）"""
    waits, rides = [], []
    for d in train:
        base = p.on_day(go.strftime("%H:%M"), d)
        deps = [a for a, _ in rets[d]]
        if not deps or not (deps[0] - timedelta(minutes=15) <= base <= deps[-1]):
            continue
        for m in range(-10, 11):
            at = base + timedelta(minutes=m)
            nxt = next((a for a in deps if a >= at), None)
            if nxt and nxt - at <= p.MAX_WAIT and p.seen(day_buses[d], at, nxt):
                waits.append((nxt - at).total_seconds() / 60)
    if not waits:
        return None
    wait = statistics.median(waits)
    for d in train:
        c = p.on_day((go + timedelta(minutes=wait)).strftime("%H:%M"), d)
        rides += [(b - a).total_seconds() / 60 for a, b in rets[d] if abs(a - c) <= p.WINDOW]
    return go + timedelta(minutes=wait + (statistics.median(rides) if rides else 8))


def site_qian(day, data_dir=p.DATA_DIR):
    """網站預估：下一班幾點到錢穆故居（回程第一站）"""
    import csv
    path = os.path.join(data_dir, f"557_預估_{day}.csv")
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8-sig", newline="") as f:
        return sorted((datetime.strptime(r["資料時間"], "%Y-%m-%d %H:%M:%S"), int(r["預估秒數"])) for r in csv.DictReader(f)
                      if r["站牌ID"] == mon.R_QIAN and int(r["預估秒數"]) > 0)


def in_return_peak(go):
    return any(a <= go.hour * 60 + go.minute < b for a, b in R_PEAKS)


def exam_return(days, tests, data_dir=p.DATA_DIR, seed=0):
    """回程四天輪流考試：學生 N 分鐘後到東吳站牌，搭第一班離開東吳的車，幾點到捷運士林站。
    回傳 {(n, 方法): {考卷: [(誤差, 是不是回程尖峰)]}}"""
    rng = np.random.default_rng(seed)
    buses = {d: p.load_day(d, data_dir) for d in days}
    events = {d: L.load_events(d, data_dir) for d in days}
    vis = {d: {v: visits(xs) for v, xs in events[d].items()} for d in days}
    segs = {d: segments(vis[d], buses[d]) for d in days}
    rets = {d: returns(d, data_dir) for d in days}
    out = {}
    for test in tests:
        train = [d for d in days if d != test]
        table = Table([s for d in train for s in segs[d]])
        etas = site_qian(test, data_dir)
        rides_all = [(b - a).total_seconds() / 60 for d in train for a, b in rets[d]]
        flat = statistics.median(rides_all) if rides_all else 8
        t, end = p.on_day(p.DAY_START, test), p.on_day(p.DAY_END, test)
        while t <= end:
            sims_out = simulate(vis[test], t, table, today_factor(segs[test], t, table), rng, board=R_BOARD, alight=R_ALIGHT)
            site = L.site_next(etas, t)
            for n in L.AHEAD:
                go = t + timedelta(minutes=n)
                act = next(((a, b) for a, b in rets[test] if a >= go), None)
                if not act or act[0] - go > p.MAX_WAIT or not p.seen(buses[test], t, act[1]):
                    continue
                real = act[1]
                v0 = return_v0(rets, train, go, buses)
                if v0 is None:
                    continue
                arr = pick(sims_out, n, (v0 - t).total_seconds() / 60)
                part = t + timedelta(minutes=float(np.median(arr)))
                web = (site + timedelta(minutes=flat)) if site and site >= go else v0
                peak = in_return_peak(go)
                for k, pr in (("Bot 現行", p.bot_estimate(go)), ("v0 歷史", v0), ("網站下一班＋固定車程", web), ("零件模型", part),
                              ("零件＋v0 平均", part + (v0 - part) / 2)):
                    out.setdefault((n, k), {}).setdefault(test, []).append(((pr - real).total_seconds() / 60, peak))
                out.setdefault((n, "零件模型 P80 涵蓋"), {}).setdefault(test, []).append(
                    (float(real <= t + timedelta(minutes=float(np.percentile(arr, 80)))), peak))
            t += timedelta(minutes=1)
        print(f"回程 {test} 考完", file=sys.stderr)
    return out


def score_rows(out, scope_of=lambda e: [e]):
    """{(n, 方法): {考卷: [誤差]}} → 成績表的列（「全部」＋每天）。scope_of 把一筆拆成 [(範圍, 誤差)]"""
    rows = []
    groups = {}
    for (n, k), by_day in out.items():
        for day, es in by_day.items():
            for e in es:
                for scope, x in scope_of(e):
                    groups.setdefault((scope, n, k), {}).setdefault(day, []).append(x)
    for (scope, n, k), by_day in groups.items():
        for exam_day in ["全部"] + list(by_day):
            e = [x for v in by_day.values() for x in v] if exam_day == "全部" else by_day[exam_day]
            if "涵蓋" in k or "比例" in k:
                row = {"平均差": "", "容許內%": round(100 * sum(e) / len(e)),
                       "容許": "目標 60%" if "P20" in k else ("" if "比例" in k else "目標 80%")}
            else:
                row = {"平均差": round(statistics.mean(map(abs, e)), 2), "容許內%": round(100 * sum(abs(x) <= 3 for x in e) / len(e)), "容許": "±3 分"}
            rows.append({"範圍": scope, "情況": f"提早 {n} 分鐘查", "方法": k, "考卷": exam_day if exam_day == "全部" else exam_day[5:],
                         **row, "筆數": len(e)})
    return rows


def write_and_print(rows, path, note):
    fields = (["範圍"] if rows and rows[0]["範圍"] else []) + ["情況", "方法", "考卷", "平均差", "容許", "容許內%", "筆數"]
    if "範圍" not in fields:
        for r in rows:
            r.pop("範圍")
    p.write_csv(path, rows, fields, note)
    for r in rows:
        if r["考卷"] == "全部":
            key = lambda x: (x.get("範圍"), x["情況"], x["方法"])
            per = "  ".join(f"{x['考卷']} {x['平均差'] if x['平均差'] != '' else str(x['容許內%']) + '%'}" for x in rows
                            if x["考卷"] != "全部" and key(x) == key(r))
            v = f"平均差 {r['平均差']} 分，±3 分內 {r['容許內%']}%" if r["平均差"] != "" else f"{r['容許內%']}%（{r['容許']}）"
            print(f"{(r.get('範圍') + ' | ') if r.get('範圍') else ''}{r['情況']} | {r['方法']}：{v}  [{per}]")
    print(f"已寫入 {path}")


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--days", nargs="+", default=L.DAYS)
    ap.add_argument("--direction", choices=["去程", "回程", "全部"], default="全部",
                    help="去程：在家 → 東吳；回程：東吳 → 捷運士林站")
    ap.add_argument("--data", default=p.DATA_DIR)
    ap.add_argument("--out", default=p.OUT_DIR)
    a = ap.parse_args()
    days_note = f"{'、'.join(d[5:] for d in a.days)} 輪流當考卷（11/24 只有傍晚）；產生時間 {datetime.now():%Y-%m-%d %H:%M}"
    if a.direction in ("去程", "全部"):
        def out_scopes(e):
            first, queued, peak = e
            got = [("全天", first)]
            if peak:
                got.append(("尖峰（07:30–08:00、09:15–10:00）", first))
                if queued is not None:
                    got.append(("尖峰・要排就等下一班", queued))
            return got
        rows = score_rows(exam(a.days, a.days, a.data), out_scopes)
        write_and_print(rows, os.path.join(a.out, f"557零件模型成績_{a.days[-1]}.csv"),
                        f"# 在家預估幾點到東吳，{days_note}。「要排就等下一班」：第一班照顏色規則要排隊，就當作上不去、改搭下一班")
    if a.direction in ("回程", "全部"):
        rows = score_rows(exam_return(a.days, a.days, a.data),
                          lambda e: [("全天", e[0])] + ([("回程尖峰", e[0])] if e[1] else []))
        write_and_print(rows, os.path.join(a.out, f"557回程成績_{a.days[-1]}.csv"),
                        f"# 回程：學生 N 分鐘後到東吳站牌，幾點到捷運士林站。回程尖峰 12:00–13:30、15:00–16:00、17:00–18:30。{days_note}")


if __name__ == "__main__":
    main()
