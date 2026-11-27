# /// script
# dependencies = ["openpyxl", "scikit-learn", "numpy"]
# ///
"""557 士林站排隊模擬：學生幾點到士林站、前面排了幾個人、接下來每班還有幾個位置 → 搭得上哪一班、幾點到東吳

為什麼要這個（11/28）：「提早幾分鐘查」跟擠不擠得上沒關係，要看學生「幾點到站」；
而且到了士林站，第一班就算沒滿也不代表輪得到他，前面可能已經有人在排。

零件：
  1. 每分鐘來排隊幾人（λ）：每 15 分鐘一格，從訓練那幾天算「士林站淨上車 ÷ 跟前一班差幾分鐘」。
     只用前一班「不用排」（排隊的人都上車了）的車；這班滿了的話上車數只是下限，所以再乘一個倍率 κ，
     κ 用訓練那幾天重播尖峰的車，挑「預測這班要排」最準的值（不偷看考卷那天）；κ 只乘在尖峰
  2. 每班剩幾個位置：65 −（離開士林國中的人數）。已經離開國中的車用網站即時人數，還沒到國中的
     從訓練那幾天同時段（前後 15 分鐘）的國中人數抽
  3. 現在排了幾人：照今天已經開走的車重播。開走的車照顏色規則「不用排」→ 隊伍清空；
     「要排」→ 留下（隊伍 − 位置）人
  4. 模擬 200 次：車幾點到用零件模型；學生到站時前面有 Q 人，每班車上 min(隊伍, 位置) 人，
     先到先上，輪到他的那班就是他搭的車

答案是範圍：網站看不到學生排第幾個，所以「實際」只知道介在「第一班」和「第一班不用排的車」之間

  uv run tools/排隊模擬557.py
"""
import argparse
import os
import sys
from datetime import timedelta

import numpy as np

import importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("parts557", os.path.join(HERE, "零件模型557.py"))
Z = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(Z)
L, p, mon = Z.L, Z.p, Z.mon

CAP = 65                 # 實測 64–66 人就滿
SLOT = 15                # 每分鐘來幾人：幾分鐘一格
JHS_WINDOW = 15          # 抽國中人數用前後幾分鐘
KAPPAS = (1.0,)                  # 試過 1.0–2.0 讓訓練天挑：會挑到 2.0、隊伍估太長、成績更差（11/28），所以固定 1
FMT = "%Y-%m-%d %H:%M:%S"


def _when(rec):
    from datetime import datetime
    return datetime.strptime(rec["回報時間"], FMT)


def bus_rows(trips, day_buses):
    """每班到士林站的車：幾點到、離開國中幾人（幾點知道）、離開士林站幾人、要不要排、幾點到東吳"""
    school = {(b["車輛ID"], b["到站"]["士林站"]): b["東吳"] for b in day_buses if "士林站" in b["到站"]}
    rows = []
    for t in trips:
        if not t["參考"]:
            continue
        bad = bool(t.get("人數不可信"))
        jhs, mrt = t.get("國中人數"), t.get("士林站人數")
        rows.append({"v": t["車輛ID"], "a": t["參考"], "東吳": school.get((t["車輛ID"], t["參考"])),
                     "jhs": None if bad or not jhs else int(jhs["車上人數"]),
                     "jhs_at": None if bad or not jhs else _when(jhs),
                     "mrt": None if bad or not mrt else int(mrt["車上人數"]),
                     "full": Z.must_queue(t)})
    return sorted(rows, key=lambda r: r["a"])


def seats(jhs):
    return max(0, CAP - jhs)


def slot_of(t):
    return int(L.tod(t)) // SLOT


def arrival_rates(rows_by_day):
    """{格子: 每分鐘來幾人}。只用「前一班不用排」的相鄰兩班：這班士林站淨上車 ÷ 間隔。
    附近格子樣本少就跟前後格子合併，都沒有就用整天"""
    num, den = {}, {}
    for rows in rows_by_day:
        for prev, cur in zip(rows, rows[1:]):
            dt = (cur["a"] - prev["a"]).total_seconds() / 60
            if prev["full"] is not False or cur["jhs"] is None or cur["mrt"] is None or not 0 < dt <= 30:
                continue
            s = slot_of(prev["a"] + (cur["a"] - prev["a"]) / 2)
            num[s] = num.get(s, 0) + max(0, cur["mrt"] - cur["jhs"])
            den[s] = den.get(s, 0) + dt
    overall = sum(num.values()) / sum(den.values()) if den else 2.0
    lam = {}
    for s in range(24 * 60 // SLOT):
        n = sum(num.get(s + d, 0) for d in (-1, 0, 1)) if den.get(s, 0) < 20 else num[s]
        d = sum(den.get(s + d, 0) for d in (-1, 0, 1)) if den.get(s, 0) < 20 else den[s]
        lam[s] = n / d if d >= 10 else overall
    return lam


def expected_arrivals(lam, t1, t2, kappa=1.0):
    """t1 到 t2 之間預計來幾人（跨格子分段算）。κ 只乘在尖峰：只有尖峰的車會滿、上車數只是下限"""
    if t2 <= t1:
        return 0.0
    total, t = 0.0, t1
    while t < t2:
        nxt = min(t2, t + timedelta(minutes=SLOT - L.tod(t) % SLOT))
        if nxt <= t:
            nxt = t2
        total += lam[slot_of(t)] * (kappa if Z.in_out_peak(t) else 1.0) * (nxt - t).total_seconds() / 60
        t = nxt
    return total


def replay(rows, lam, upto, kappa=1.0):
    """照今天已經開走、而且已經知道人數的車重播，回傳 (upto 這一刻大約排了幾人, 最後一班幾點開走)。
    不用排（或沒人數）→ 隊伍清空；要排 → 留下（隊伍 − 位置）"""
    q, last = 0.0, None
    for r in rows:
        if r["a"] + timedelta(minutes=1) > upto:
            break
        if last is not None:
            q += expected_arrivals(lam, last, r["a"], kappa)
        if r["full"]:
            q = max(0.0, q - seats(r["jhs"] if r["jhs"] is not None else 0))
        else:
            q = 0.0
        last = r["a"]
    return q, last


def jhs_pool(rows_by_day):
    """訓練那幾天每班的 (幾點到士林站, 離開國中幾人)"""
    return np.array([(L.tod(r["a"]), r["jhs"]) for rows in rows_by_day for r in rows if r["jhs"] is not None], float)


def sample_jhs(pool, tod, rng, k):
    near = pool[np.abs(pool[:, 0] - tod) <= JHS_WINDOW, 1]
    if len(near) < 5:
        near = pool[:, 1]
    return rng.choice(near, k)


def queue_sim(cands, q0, t0, n, lam, kappa, rng, fallback, sims=Z.SIMS):
    """cands：[(到士林站分鐘 [sims], 到東吳分鐘 [sims], 位置 [sims])]，時間都是從現在 t0 算。
    q0：現在排了幾人；學生 n 分鐘後到。
    回傳 (到東吳分鐘 [sims], 第一班要排 [sims], 前面幾人 [sims], 排最後面的話到東吳分鐘 [sims])"""
    out = np.full(sims, float(fallback))
    worst = np.full(sims, float(fallback))
    first_full = np.zeros(sims, bool)
    ahead_at = np.zeros(sims)
    if not cands:
        return out, first_full, ahead_at, worst
    M = np.stack([c[0] for c in cands])
    S = np.stack([c[1] for c in cands])
    SE = np.stack([c[2] for c in cands])
    wait = p.MAX_WAIT.total_seconds() / 60
    for s in range(sims):
        order = np.argsort(M[:, s])
        q, clock, student = q0, 0.0, None   # student：學生前面還有幾人（還沒到站是 None）
        first = True
        for i in order:
            m = M[i, s]
            if m < 0:
                continue
            if student is None and m >= n:
                q += rng.poisson(expected_arrivals(lam, t0 + timedelta(minutes=clock), t0 + timedelta(minutes=n), kappa))
                clock, student = n, q
                ahead_at[s] = q
            if m - n > wait:
                break
            q += rng.poisson(expected_arrivals(lam, t0 + timedelta(minutes=clock), t0 + timedelta(minutes=m), kappa))
            clock = m
            room = SE[i, s]
            if student is not None:
                if first:
                    first_full[s] = q >= room
                    first = False
                if out[s] == fallback and student < room:
                    out[s] = S[i, s]
                if q <= room:          # 整條隊伍都上車：排最後面也搭得上
                    worst[s] = S[i, s]
                    break
                student = max(0, student - room)
            q = max(0, q - room)
    return out, first_full, ahead_at, worst


def fit_kappa(rows_by_day, lam):
    """訓練那幾天重播尖峰的車：到站前一刻的隊伍 vs 位置，挑「預測要排」最接近實際（Brier 最小）的倍率"""
    best = None
    for k in KAPPAS:
        errs = []
        for rows in rows_by_day:
            for r in rows:
                if r["full"] is None or r["jhs"] is None or not Z.in_out_peak(r["a"]):
                    continue
                q, last = replay(rows, lam, r["a"] - timedelta(seconds=1), k)
                if last is None:
                    continue
                q += expected_arrivals(lam, last, r["a"], k)
                # 隊伍大約是 Poisson：超過位置的機率
                mu, room = q, seats(r["jhs"])
                prob = 1 - _poisson_cdf(room - 1, mu)
                errs.append((prob - float(r["full"])) ** 2)
        b = float(np.mean(errs)) if errs else 1.0
        if best is None or b < best[1]:
            best = (k, b)
    return best[0]


def _poisson_cdf(k, mu):
    if k < 0:
        return 0.0
    term = total = np.exp(-mu)
    for i in range(1, int(k) + 1):
        term *= mu / i
        total += term
    return float(min(1.0, total))


def exam(days, tests, data_dir=p.DATA_DIR, seed=0):
    """四天輪流考試。回傳 {(n, 方法): {考卷: [(值, 是不是尖峰)]}}"""
    rng = np.random.default_rng(seed)
    buses = {d: p.load_day(d, data_dir) for d in days}
    events = {d: L.load_events(d, data_dir) for d in days}
    vis = {d: {v: Z.visits(xs) for v, xs in events[d].items()} for d in days}
    segs = {d: Z.segments(vis[d], buses[d]) for d in days}
    rows = {d: bus_rows(L.load_trips(d, data_dir), buses[d]) for d in days}
    out, info = {}, {}

    def add(n, k, test, v, peak):
        out.setdefault((n, k), {}).setdefault(test, []).append((v, peak))
    for test in tests:
        train = [d for d in days if d != test]
        table = Z.Table([s for d in train for s in segs[d]])
        lam = arrival_rates([rows[d] for d in train])
        kappa = fit_kappa([rows[d] for d in train], lam)
        pool = jhs_pool([rows[d] for d in train])
        full_rate = {}
        for d in train:
            for r in rows[d]:
                if r["full"] is not None:
                    full_rate.setdefault(slot_of(r["a"]), []).append(float(r["full"]))
        info[test] = {"kappa": kappa, "lam": lam}
        rx, ry = L.ride_samples([b for d in train for b in buses[d]])
        ride_model = L.gbr().fit(rx, ry)
        tb, tr = buses[test], rows[test]
        mrt = [r for r in tr if r["東吳"]]
        t, end = p.on_day(p.DAY_START, test), p.on_day(p.DAY_END, test)
        while t <= end:
            fac = Z.today_factor(segs[test], t, table)
            per_bus = [(v, Z.simulate({v: xs}, t, table, fac, rng)) for v, xs in vis[test].items()]
            per_bus = [(v, one[0]) for v, one in per_bus if one]
            sims_out = [ms for _, ms in per_bus]
            # 每台車接下來那班的位置：已經離開國中就用網站人數，不然從訓練那幾天抽
            cands = []
            for v, (m, s) in per_bus:
                nxt = next((r for r in tr if r["v"] == v and r["a"] >= t), None)
                if nxt and nxt["jhs_at"] and nxt["jhs_at"] <= t:
                    room = np.full(len(m), float(seats(nxt["jhs"])))
                else:
                    room = np.maximum(0, CAP - sample_jhs(pool, L.tod(t) + float(np.median(m)), rng, len(m)))
                cands.append((m, s, room))
            q0, last = replay(tr, lam, t, kappa)
            if last is not None:
                q0 += expected_arrivals(lam, last, t, kappa)
            for n in L.AHEAD:
                go = t + timedelta(minutes=n)
                act = next((r for r in mrt if r["a"] >= go), None)
                if not act or act["a"] - go > p.MAX_WAIT or not p.seen(tb, t, act["a"]):
                    continue
                clear = next((r for r in mrt if r["a"] >= go and not r["full"]), None)
                hi = clear["東吳"] if clear and clear["a"] - go <= p.MAX_WAIT else None
                lo = act["東吳"]
                peak = Z.in_out_peak(go)
                hist = go + timedelta(minutes=Z.hist_wait(buses, train, go))
                v0 = hist + timedelta(minutes=float(ride_model.predict([[L.tod(hist), hist.weekday()]])[0]))
                fb = (v0 - t).total_seconds() / 60
                first = Z.pick(sims_out, n, fb)
                qs, ff, ahead, worst = queue_sim(cands, q0, t, n, lam, kappa, rng, fb)
                preds = {"零件模型（搭第一班）": first, "排隊模擬": qs, "排最後面（最壞情況）": worst}
                for k, arr in preds.items():
                    pr = t + timedelta(minutes=float(np.median(arr)))
                    if hi is not None:
                        dist = max(0.0, (lo - pr).total_seconds() / 60, (pr - hi).total_seconds() / 60)
                        add(n, k, test, dist, peak)
                p80 = t + timedelta(minutes=float(np.percentile(qs, 80)))
                if hi is not None:
                    add(n, "排隊模擬 P80 晚於第一班不用排的車", test, float(p80 >= hi), peak)
                if act["full"] is not None:
                    add(n, "第一班要排：排隊模擬", test, (float(ff.mean()), act["full"]), peak)
                    hr = full_rate.get(slot_of(act["a"]))
                    add(n, "第一班要排：歷史同時段比例", test, (float(np.mean(hr)) if hr else 0.0, act["full"]), peak)
                add(n, "前面排幾人", test, float(np.median(ahead)), peak)
                if hi is not None:
                    add(n, "範圍寬度（分）", test, (hi - lo).total_seconds() / 60, peak)
            t += timedelta(minutes=1)
        print(f"{test} 考完（κ = {kappa}）", file=sys.stderr)
    return out, info


def summarize(out):
    """印出結果、回傳成績表的列"""
    rows = []
    for scope, keep in (("全天", lambda pk: True), ("尖峰（07:30–08:00、09:15–10:00）", lambda pk: pk)):
        for (n, k), by_day in sorted(out.items(), key=lambda x: (x[0][0], x[0][1])):
            for day in ["全部"] + sorted(by_day):
                xs = [v for d, es in by_day.items() if day in ("全部", d) for v, pk in es if keep(pk)]
                if not xs:
                    continue
                if k.startswith("第一班要排"):
                    q = np.array([a for a, _ in xs]); o = np.array([float(b) for _, b in xs])
                    row = {"值": round(float(np.mean((q - o) ** 2)), 3), "說明": f"Brier（越小越好）；實際要排 {100 * o.mean():.0f}%"}
                elif k in ("前面排幾人", "範圍寬度（分）"):
                    row = {"值": round(float(np.mean(xs)), 1), "說明": "平均"}
                elif "P80" in k:
                    row = {"值": round(100 * float(np.mean(xs))), "說明": "%"}
                else:
                    a = np.array(xs)
                    row = {"值": round(float(a.mean()), 2), "說明": f"離範圍平均幾分；落在範圍 ±3 分內 {100 * np.mean(a <= 3):.0f}%、正好在範圍內 {100 * np.mean(a == 0):.0f}%"}
                rows.append({"範圍": scope, "情況": f"提早 {n} 分鐘查", "方法": k, "考卷": day if day == "全部" else day[5:], **row, "筆數": len(xs)})
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
    out, info = exam(a.days, a.days, a.data)
    rows = summarize(out)
    for test, x in info.items():
        peaks = {f"{s * SLOT // 60:02d}:{s * SLOT % 60:02d}": round(x["lam"][s], 1) for s in range(28, 41)}
        print(f"{test} 當考卷：κ = {x['kappa']}，每分鐘來幾人（尖峰再乘 κ）{peaks}")
    for r in rows:
        if r["考卷"] == "全部":
            print(f"{r['範圍']} | {r['情況']} | {r['方法']}：{r['值']}（{r['說明']}，{r['筆數']} 筆）")
    path = os.path.join(a.out, f"557排隊模擬成績_{a.days[-1]}.csv")
    p.write_csv(path, rows, ["範圍", "情況", "方法", "考卷", "值", "說明", "筆數"],
                "# 士林站排隊模擬。實際答案是範圍：第一班 ～ 第一班不用排的車（網站看不到學生排第幾個）")
    print(f"已寫入 {path}")


if __name__ == "__main__":
    main()
