# /// script
# dependencies = ["openpyxl", "scikit-learn", "numpy"]
# ///
"""實驗（11/28）：零件模型接上「擠不擠得上」——每台車預測離開士林站會不會滿（剩不到 10 個位置），
滿了就等下一班。結果寫在 到校時間預測.md「擠不擠得上接進零件模型」。

做法：擁擠模型預測「離開士林站至少坐了幾人」（扣掉國中以前上車的），車已經離開士林國中就加上網站的
國中人數；再用訓練那幾天「沒看過那天」的預測，學一條邏輯迴歸換算成「會滿的機率」，模擬時照機率判斷。
對答案：同樣用網站人數、同樣的門檻算「實際要等第幾班」（只能證明跟規則一致，證明不了現場擠不擠得上）。

  在專案根目錄執行：uv run tools/實驗/擠不擠得上557.py 結果.pkl
"""
import importlib.util, statistics as st, sys, pickle, csv
from datetime import datetime, timedelta
import numpy as np

spec = importlib.util.spec_from_file_location("Z", "tools/零件模型557.py"); Z = importlib.util.module_from_spec(spec); spec.loader.exec_module(Z)
L, p, mon = Z.L, Z.p, Z.mon
DAYS = L.DAYS
CAP = mon.CAPACITY
JHS_POS = L.POS[(0, mon.JHS)]
UP_STOP = mon.BEFORE_JHS[-1]
SEATS = (10,)
F = "%Y-%m-%d %H:%M:%S"

buses = {d: p.load_day(d) for d in DAYS}
trips = {d: L.load_trips(d) for d in DAYS}
events = {d: L.load_events(d) for d in DAYS}
vis = {d: {v: Z.visits(xs) for v, xs in events[d].items()} for d in DAYS}
segs = {d: Z.segments(vis[d], buses[d]) for d in DAYS}


def crowd_raw(day):
    out = {}
    with open(f"data/557監測/557_人數_{day}.csv", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            out.setdefault(r["車輛ID"], []).append((datetime.strptime(r["回報時間"], F), r["站牌ID"], int(r["車上人數"])))
    return {v: sorted(set(x)) for v, x in out.items()}


CROWD = {d: crowd_raw(d) for d in DAYS}


def load_rows(day):
    """每班：幾點到士林站、跟前一班隔多久、離開國中幾人、到國中時車上幾人 → 離開士林站「至少」坐了幾人（扣掉國中以前上車的）"""
    out = []
    for t in trips[day]:
        if not t["參考"] or not t["士林站人數"] or t["人數不可信"]:
            continue
        up = int(t["國中到站人數"]["車上人數"]) if t["國中到站人數"] else 0
        y = int(t["士林站人數"]["車上人數"])
        out.append({"tod": L.tod(t["參考"]), "head": float(t["間隔"]) if t["間隔"] != "" else np.nan,
                    "jhs": int(t["國中人數"]["車上人數"]) if t["國中人數"] else np.nan, "up": up, "z": max(0, y - up)})
    return out


ROWS = {d: load_rows(d) for d in DAYS}
EARLY, NEAR = ["tod", "head"], ["tod", "head", "jhs", "up"]


def fit(rows, cols):
    return L.gbr().fit([[r[c] for c in cols] for r in rows], [r["z"] for r in rows])


def oof_resid(train, cols):
    """訓練那幾天內再輪流考一次，拿到「沒看過的日子」的誤差分布，模擬時從裡面抽"""
    out = []
    for d in train:
        tr = [r for o in train if o != d for r in ROWS[o]]
        if len(tr) < 30 or not ROWS[d]:
            continue
        rs = [r for r in ROWS[d] if all(r[c] == r[c] for c in cols if c != "head")]
        if rs:
            out += list(np.array([r["z"] for r in rs]) - fit(tr, cols).predict([[r[c] for c in cols] for r in rs]))
    return np.array(out)


def oof_pred(train, cols):
    """訓練那幾天內輪流考：每班「沒看過那天」時預測坐了幾人，和實際"""
    P, Y = [], []
    for d in train:
        tr = [r for o in train if o != d for r in ROWS[o] if all(r[c] == r[c] for c in cols if c != "head")]
        rs = [r for r in ROWS[d] if all(r[c] == r[c] for c in cols if c != "head")]
        if len(tr) < 30 or not rs:
            continue
        P += list(fit(tr, cols).predict([[r[c] for c in cols] for r in rs])); Y += [r["z"] for r in rs]
    return np.array(P), np.array(Y)


def calibrate(train, cols, k):
    """預測坐了幾人 → 這班剩不到 k 個位置（滿）的機率：用訓練那幾天沒看過的預測學一條邏輯迴歸"""
    from sklearn.linear_model import LogisticRegression
    P, Y = oof_pred(train, cols)
    y = (CAP - Y < k).astype(int)
    if y.sum() == 0:
        return lambda pz: 0.0
    m = LogisticRegression(C=1.0).fit(P.reshape(-1, 1), y)
    return lambda pz: float(m.predict_proba([[pz]])[0, 1])


def live_counts(day, v, t, t0):
    """車在士林國中（還沒到士林站）：離開國中的人數、到國中時車上的人數（網站即時回報）；國中以前一次多上超過 15 人就當作不知道"""
    xs = [x for x in CROWD[day].get(v, []) if t0 - timedelta(minutes=20) <= x[0] <= t]
    jhs = [n for tt, s, n in xs if s == mon.JHS and tt >= t0 - timedelta(minutes=1)]
    if not jhs:
        return None
    upstream = [n for tt, s, n in xs if s in mon.BEFORE_JHS]
    if any(b - a > mon.SURGE_LIMIT for a, b in zip(upstream, upstream[1:])):
        return "unknown"
    up = [n for tt, s, n in xs if s == UP_STOP]
    return jhs[-1], (up[-1] if up else 0)


def hist_wait_k(train, go, k):
    ws = []
    for d in train:
        at = p.on_day(go.strftime("%H:%M"), d)
        if p.covers(buses[d], "士林站", at):
            ws += p.wait_samples(buses[d], "士林站", at, k, p.WINDOW)
    return st.median(ws) if ws else None


def first_ok_rate(train, go, k):
    """歷史上這個時間到站，第一班就上得去的比例（基準）"""
    hits = []
    for d in train:
        for m in range(-10, 11):
            at = p.on_day(go.strftime("%H:%M"), d) + timedelta(minutes=m)
            if not p.covers(buses[d], "士林站", at):
                continue
            nxt = p.first_bus(buses[d], "士林站", at, -999)
            if nxt and p.seen(buses[d], at, nxt["到站"]["士林站"]):
                left = nxt["剩位"]["士林站"]
                hits.append(left is None or left >= k)
    return np.mean(hits) if hits else 0.8


rng = np.random.default_rng(0)
res = {}
def add(key, test, v):
    res.setdefault(key, {}).setdefault(test, []).append(v)

for test in DAYS:
    train = [d for d in DAYS if d != test]
    table = Z.Table([s for d in train for s in segs[d]])
    tr_rows = [r for d in train for r in ROWS[d]]
    m_early = fit(tr_rows, EARLY)
    m_near = fit([r for r in tr_rows if r["jhs"] == r["jhs"]], NEAR)
    cal_early, cal_near = calibrate(train, EARLY, SEATS[0]), calibrate(train, NEAR, SEATS[0])
    rx, ry = L.ride_samples([b for d in train for b in buses[d]])
    ride_model = L.gbr().fit(rx, ry)
    ride_cache = {}
    def arrive(at):
        if at not in ride_cache:
            ride_cache[at] = at + timedelta(minutes=float(ride_model.predict([[L.tod(at), at.weekday()]])[0]))
        return ride_cache[at]
    tb = buses[test]
    mrt_times = sorted(b["到站"]["士林站"] for b in tb if "士林站" in b["到站"])
    past_arr = sorted(a for v in L.mrt_arrivals(events[test]).values() for a in v)
    t, end = p.on_day(p.DAY_START, test), p.on_day(p.DAY_END, test)
    while t <= end:
        fac = Z.today_factor(segs[test], t, table)
        # 模擬每台車，同時記下是哪台車、現在在哪
        sims, info = [], []
        for v, xs in vis[test].items():
            one = Z.simulate({v: xs}, t, table, fac, rng)
            if one:
                last = max((x for x in xs if x[0] <= t), key=lambda x: x[0])
                sims.append(one[0]); info.append((v, last))
        if sims:
            M = np.stack([m for m, _ in sims]); S = np.stack([s for _, s in sims])
            med = np.median(M, axis=1)
            order = np.argsort(med)
            prev_t = max([(a - t).total_seconds() / 60 for a in past_arr if a <= t], default=-10.0)
            FULL = np.zeros(M.shape, bool)
            for i in order:
                head = med[i] - prev_t; prev_t = med[i]
                v, (t0, pos) = info[i]
                lc = live_counts(test, v, t, t0) if pos == JHS_POS else None
                if lc == "unknown":
                    continue
                if lc:
                    pf = cal_near(m_near.predict([[L.tod(t) + med[i], head, lc[0], lc[1]]])[0])
                else:
                    pf = cal_early(m_early.predict([[L.tod(t) + med[i], head]])[0])
                FULL[i] = rng.random(M.shape[1]) < pf
        for n in L.AHEAD:
            go = t + timedelta(minutes=n)
            act0 = next((a for a in mrt_times if a >= go), None)
            if not act0 or act0 - go > p.MAX_WAIT or not p.seen(tb, t, act0):
                continue
            for k in SEATS:
                b = p.first_bus(tb, "士林站", go, k)
                if not b or not p.seen(tb, t, b["到站"]["士林站"]):
                    continue
                real = b["東吳"]
                skipped = sum(1 for a in mrt_times if go <= a < b["到站"]["士林站"])
                hw = hist_wait_k(train, go, k)
                v0 = arrive(go + timedelta(minutes=hw if hw is not None else 10))
                fb = (v0 - t).total_seconds() / 60
                if sims:
                    in_win = (M >= n) & (M <= n + 45)
                    ok = in_win & ~FULL
                    def choose(mask):
                        idx = np.where(mask, M, np.inf).argmin(axis=0)
                        return np.where(mask.any(axis=0), S[idx, np.arange(M.shape[1])], fb), np.where(mask.any(axis=0), M[idx, np.arange(M.shape[1])], np.inf)
                    s_plain, m_plain = choose(in_win)
                    s_crowd, m_crowd = choose(ok)
                    nskip = (in_win & (M < m_crowd[None, :])).sum(axis=0)
                    p_first = float(np.mean(nskip == 0))
                    plain = t + timedelta(minutes=float(np.median(s_plain)))
                    crowd = t + timedelta(minutes=float(np.median(s_crowd)))
                    p80 = t + timedelta(minutes=float(np.percentile(s_crowd, 80)))
                    pred_skip = int(np.median(nskip))
                else:
                    plain = crowd = p80 = v0; p_first = first_ok_rate(train, go, k); pred_skip = 0
                both = crowd + (v0 - crowd) / 2 if n >= 10 else crowd
                for name, pr in (("Bot", p.bot_estimate(go)), (f"v0（門檻 {k}）", v0), ("零件（不看擠）", plain),
                                 ("零件＋擠", crowd), ("結合（零件＋擠，10 分以上和 v0 平均）", both)):
                    add((n, k, name), test, (pr - real).total_seconds() / 60)
                add((n, k, "P80 涵蓋"), test, float(real <= p80))
                add((n, k, "第一班上得去：預測機率"), test, (p_first, skipped == 0))
                add((n, k, "第一班上得去：歷史比例"), test, (first_ok_rate(train, go, k) if n in (0, 30) else None, skipped == 0))
                add((n, k, "等第幾班猜中"), test, float(pred_skip == min(skipped, 3)))
                add((n, k, "實際要跳過幾班"), test, skipped)
        t += timedelta(minutes=1)
    print("done", test, file=sys.stderr)

pickle.dump(res, open(sys.argv[1], "wb"))
for k in SEATS:
    print(f"\n======== 門檻 {k}（離開士林站至少剩 {k} 個位置才算上得去） ========")
    for n in L.AHEAD:
        print(f" 提早 {n} 分鐘")
        for name in ("Bot", f"v0（門檻 {k}）", "零件（不看擠）", "零件＋擠", "結合（零件＋擠，10 分以上和 v0 平均）"):
            e = res[(n, k, name)]
            allv = [abs(x) for v in e.values() for x in v]
            per = "  ".join(f"{d[5:]} {np.mean(np.abs(v)):.2f}" for d, v in e.items())
            print(f"   {name:30s} {np.mean(allv):.2f}  ±3內 {100*np.mean(np.array(allv) <= 3):.0f}%  [{per}]")
        sk = [x for v in res[(n, k, "實際要跳過幾班")].values() for x in v]
        pf = [x for v in res[(n, k, "第一班上得去：預測機率")].values() for x in v]
        brier = np.mean([(q - o) ** 2 for q, o in pf])
        hb = [x for v in res[(n, k, "第一班上得去：歷史比例")].values() for x in v if x[0] is not None]
        hbs = f"，歷史比例 Brier {np.mean([(q - o) ** 2 for q, o in hb]):.3f}" if hb else ""
        guess = np.mean([x for v in res[(n, k, "等第幾班猜中")].values() for x in v])
        cov = np.mean([x for v in res[(n, k, "P80 涵蓋")].values() for x in v])
        print(f"   實際第一班就上不去 {100*np.mean(np.array(sk) > 0):.0f}%（跳過 1 班 {100*np.mean(np.array(sk)==1):.0f}%、2 班以上 {100*np.mean(np.array(sk)>=2):.0f}%）"
              f"｜第一班上得去機率 Brier {brier:.3f}{hbs}｜等第幾班猜中 {100*guess:.0f}%｜P80 涵蓋 {100*cov:.0f}%")
