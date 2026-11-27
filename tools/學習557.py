# /// script
# dependencies = ["openpyxl", "scikit-learn", "numpy"]
# ///
"""557 機器學習模型：在家提早預估幾點到東吳，以及這班車會多擠

三個模型（都是梯度提升樹 HistGradientBoosting，資料少、特徵少，比較不容易背答案）：
  1. 車輛位置 → 幾分鐘後到士林站：路上每台車（含還在跑回程、等一下掉頭的車）現在在哪一站、
     多久前回報、現在幾點、星期幾 → 這台車幾分鐘後開到捷運士林站。學生在家提早 N 分鐘查，
     就挑「N 分鐘後第一台到站的車」
  2. 車程：士林站 → 東吳幾分鐘（幾點、星期幾）
  3. 擁擠：這班離開士林站時網站顯示車上幾人（幾點、星期幾、跟前一班隔多久、前一班幾人；
     車快到時再加上離開士林國中的人數）

怎麼證明有效（輪流考試）：每次留一天當考卷、用其他天訓練，模型沒看過考卷那天；
每個模型都跟 v0（預測557.py 的統計方法）、Bot 現行算法比。

  uv run tools/學習557.py
"""
import argparse
import csv
import importlib.util
import os
import statistics
import sys
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("predict557", os.path.join(HERE, "預測557.py"))
p = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(p)
mon = p.mon

DAYS = ["2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27"]
AHEAD = (0, 10, 20, 30)  # 在家提早幾分鐘查
F = "%Y-%m-%d %H:%M:%S"
# 一台車一圈的站序：回程每一站，接著去程每一站。位置 = 在這一圈的第幾站
POS = {(1, s): i for i, s in enumerate(mon.R_ROUTE)} | {(0, s): len(mon.R_ROUTE) + i for i, s in enumerate(mon.ROUTE)}
MRT_POS = POS[(0, mon.MRT)]
STALE = timedelta(minutes=10)    # 超過這麼久沒回報的車，不知道在哪，不拿來算
HORIZON = timedelta(minutes=90)  # 位置模型只學 90 分鐘內會到士林站的車
PEAK = (450, 525)                # 07:30–08:45 塞車時段（從當天 0 點算第幾分鐘）


def tod(t):
    return t.hour * 60 + t.minute + t.second / 60


# ---------- 資料整理（不用 sklearn，可以單獨測試） ----------

def load_events(day, data_dir=p.DATA_DIR):
    """原始到離站紀錄 → {車輛ID: [(時間, 位置), …]}"""
    out = {}
    with open(os.path.join(data_dir, f"557_raw_{day}.csv"), encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            k = (int(r["去返程"]), r["站牌ID"])
            if k in POS:
                out.setdefault(r["車輛ID"], []).append((datetime.strptime(r["事件時間"], F), POS[k]))
    return {v: sorted(set(xs)) for v, xs in out.items()}


def mrt_arrivals(events):
    """每台車每一趟到捷運士林站（去程）的時間；同一趟的到站、離站兩筆只留第一筆"""
    out = {}
    for v, xs in events.items():
        ts = [t for t, pos in xs if pos == MRT_POS]
        out[v] = [t for i, t in enumerate(ts) if i == 0 or t - ts[i - 1] > STALE]
    return out


def state(xs, t):
    """t 這一刻這台車最後回報在哪：(回報時間, 位置)；太久沒回報就 None"""
    last = None
    for x in xs:
        if x[0] > t:
            break
        last = x
    return last if last and t - last[0] <= STALE else None


def position_features(at, last):
    return [last[1], (at - last[0]).total_seconds() / 60, tod(at), at.weekday()]


def position_samples(events, arrivals, day_buses, start, end, step=2):
    """每 step 分鐘，路上每台車一筆：(特徵, 幾分鐘後到士林站)。監測有斷的時段不用"""
    X, y, t = [], [], start
    while t <= end:
        for v, xs in events.items():
            last = state(xs, t)
            nxt = next((a for a in arrivals.get(v, []) if a > t), None)
            if last and nxt and nxt - t <= HORIZON and p.seen(day_buses, t, nxt):
                X.append(position_features(t, last))
                y.append((nxt - t).total_seconds() / 60)
        t += timedelta(minutes=step)
    return X, y


def ride_samples(day_buses):
    X, y = [], []
    for b in day_buses:
        at = b["到站"].get("士林站")
        if at:
            X.append([tod(at), at.weekday()])
            y.append((b["東吳"] - at).total_seconds() / 60)
    return X, y


def crowd_rows(trips):
    """每班離開士林站時網站顯示的人數，和預測它用得到的資料。人數被清掉的班不用"""
    out, prev = [], None
    for t in sorted((t for t in trips if t["參考"]), key=lambda t: t["參考"]):
        if not t["士林站人數"] or t["人數不可信"]:
            continue
        at = t["參考"]
        n = int(t["士林站人數"]["車上人數"])
        out.append({"tod": tod(at), "wd": at.weekday(), "head": float(t["間隔"]) if t["間隔"] != "" else float("nan"),
                    "prev": prev if prev is not None else float("nan"),
                    "jhs": int(t["國中人數"]["車上人數"]) if t["國中人數"] else float("nan"), "y": n})
        prev = n
    return out


def load_trips(day, data_dir=p.DATA_DIR):
    events = mon.load_csv(os.path.join(data_dir, f"557_raw_{day}.csv"), mon.event_key)
    crowds = mon.fresh(mon.load_csv(os.path.join(data_dir, f"557_人數_{day}.csv"), mon.crowd_key))
    return mon.build_trips(events, crowds)


def site_next(etas, t):
    """t 這一刻網站說下一班幾點到捷運士林站（1 分鐘內的預估才算）"""
    last = None
    for x in etas:
        if x[0] > t:
            break
        last = x
    return last[0] + timedelta(seconds=last[1]) if last and t - last[0] <= timedelta(minutes=1) else None


def load_site_etas(day, data_dir=p.DATA_DIR):
    path = os.path.join(data_dir, f"557_預估_{day}.csv")
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8-sig", newline="") as f:
        return sorted((datetime.strptime(r["資料時間"], F), int(r["預估秒數"])) for r in csv.DictReader(f)
                      if r["站牌ID"] == mon.MRT and int(r["預估秒數"]) > 0)


def score(errs, tol=3):
    """平均差多少、差在 tol 以內的比例"""
    errs = [abs(e) for e in errs]
    return {"平均差": round(statistics.mean(errs), 2), "容許內%": round(100 * sum(e <= tol for e in errs) / len(errs)), "筆數": len(errs)}


# ---------- 模型與輪流考試 ----------

def gbr(**kw):
    from sklearn.ensemble import HistGradientBoostingRegressor
    args = dict(max_iter=200, learning_rate=0.05, max_depth=3, min_samples_leaf=10, loss="absolute_error", random_state=0)
    args.update(kw)
    return HistGradientBoostingRegressor(**args)


def exam_ride(buses, tests):
    """車程：固定（整天中位數）、v0 滑動窗、ML"""
    out = {}
    for test in tests:
        train = [b for d, bs in buses.items() if d != test for b in bs]
        X, y = ride_samples(train)
        Xt, yt = ride_samples(buses[test])
        m = gbr().fit(X, y)
        med = statistics.median(y)
        for k, preds in (("固定車程", [med] * len(yt)),
                         ("v0 滑動窗", [statistics.median([b for a, b in zip(X, y) if abs(a[0] - x[0]) <= 10] or [med]) for x in Xt]),
                         ("機器學習", list(m.predict(Xt)))):
            for x, pr, real in zip(Xt, preds, yt):
                out.setdefault(("全天", k), []).append(pr - real)
                if PEAK[0] <= x[0] < PEAK[1]:
                    out.setdefault(("07:30–08:45 塞車", k), []).append(pr - real)
    return out


def exam_crowd(rows, tests):
    """擁擠：同時段歷史中位數 vs ML（提早、車快到）"""
    out = {}
    cols_early, cols_near = ["tod", "wd", "head", "prev"], ["tod", "wd", "head", "prev", "jhs"]
    for test in tests:
        tr = [r for d, rs in rows.items() if d != test for r in rs]
        te = rows[test]
        ys = [r["y"] for r in te]
        hist = [statistics.median([q["y"] for q in tr if abs(q["tod"] - r["tod"]) <= 15] or [q["y"] for q in tr]) for r in te]
        out.setdefault("同時段歷史", []).extend(a - b for a, b in zip(hist, ys))
        for name, cols in (("機器學習（提早，不知道國中人數）", cols_early), ("機器學習（車快到，知道國中人數）", cols_near)):
            m = gbr().fit([[r[c] for c in cols] for r in tr], [r["y"] for r in tr])
            out.setdefault(name, []).extend(a - b for a, b in zip(m.predict([[r[c] for c in cols] for r in te]), ys))
    return out


def exam_home(buses, events, arrivals, tests, data_dir=p.DATA_DIR):
    """在家提早 N 分鐘查：幾點到東吳。不看擠不擠得上（網站沒有排隊人數），只比時間"""
    out = {}
    for test in tests:
        train = [d for d in buses if d != test]
        X, y = [], []
        for d in train:
            a, b = position_samples(events[d], arrivals[d], buses[d], p.on_day("06:40", d), p.on_day("18:40", d))
            X += a
            y += b
        pos_model = gbr(max_iter=300, max_depth=4, min_samples_leaf=20).fit(X, y)
        rx, ry = ride_samples([b for d in train for b in buses[d]])
        ride_model = gbr().fit(rx, ry)
        tb = buses[test]
        mrt = sorted((b["到站"]["士林站"], b) for b in tb if "士林站" in b["到站"])
        etas = load_site_etas(test, data_dir)
        t, end = p.on_day(p.DAY_START, test), p.on_day(p.DAY_END, test)
        while t <= end:
            lasts = [s for s in (state(xs, t) for xs in events[test].values()) if s]
            coming = sorted(t + timedelta(minutes=float(m)) for m in pos_model.predict([position_features(t, s) for s in lasts])) if lasts else []
            site = site_next(etas, t)
            for n in AHEAD:
                go = t + timedelta(minutes=n)
                act = next((b for a, b in mrt if a >= go), None)
                if not act or act["到站"]["士林站"] - go > p.MAX_WAIT or not p.seen(tb, t, act["到站"]["士林站"]):
                    continue
                ws = []
                for d in train:
                    at = p.on_day(go.strftime("%H:%M"), d)
                    if p.covers(buses[d], "士林站", at):
                        ws += p.wait_samples(buses[d], "士林站", at, -999, p.WINDOW)
                hist = go + timedelta(minutes=statistics.median(ws) if ws else 8)
                ml = next((c for c in coming if c >= go and c - go <= p.MAX_WAIT), hist)
                web = site if site and site >= go else hist
                rides = {}

                def arrive(bus_at):
                    if bus_at not in rides:
                        rides[bus_at] = bus_at + timedelta(minutes=float(ride_model.predict([[tod(bus_at), bus_at.weekday()]])[0]))
                    return rides[bus_at]
                real = act["東吳"]
                for k, pred in (("Bot 現行", p.bot_estimate(go)), ("v0 歷史", arrive(hist)),
                                ("網站下一班（不夠用歷史）", arrive(web)), ("機器學習（車輛位置）", arrive(ml))):
                    out.setdefault((n, k), []).append((pred - real).total_seconds() / 60)
            t += timedelta(minutes=1)
    return out


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--days", nargs="+", default=DAYS, help="用哪幾天；第一天只跑了半天的只拿來訓練")
    ap.add_argument("--data", default=p.DATA_DIR)
    ap.add_argument("--out", default=p.OUT_DIR)
    a = ap.parse_args()
    days, tests = a.days, [d for d in a.days if d != "2026-11-24"]
    buses = {d: p.load_day(d, a.data) for d in days}
    trips = {d: load_trips(d, a.data) for d in days}
    events = {d: load_events(d, a.data) for d in days}
    arrivals = {d: mrt_arrivals(events[d]) for d in days}

    rows = []
    for (period, k), e in exam_ride(buses, tests).items():
        rows.append({"模型": "車程（士林站→東吳）", "情況": period, "方法": k, **score(e), "容許": "±3 分", "單位": "分"})
    for k, e in exam_crowd({d: crowd_rows(trips[d]) for d in days}, tests).items():
        rows.append({"模型": "擁擠（離開士林站車上幾人）", "情況": "全天", "方法": k, **score(e, 10), "容許": "±10 人", "單位": "人"})
    for (n, k), e in sorted(exam_home(buses, events, arrivals, tests, a.data).items()):
        rows.append({"模型": "在家預估幾點到東吳", "情況": f"提早 {n} 分鐘查", "方法": k, **score(e), "容許": "±3 分", "單位": "分"})
    fields = ["模型", "情況", "方法", "平均差", "單位", "容許", "容許內%", "筆數"]
    path = os.path.join(a.out, f"557機器學習成績_{days[-1]}.csv")
    p.write_csv(path, rows, fields, f"# 輪流考試：{'、'.join(d[5:] for d in tests)} 輪流當考卷，其他天訓練；產生時間 {datetime.now():%Y-%m-%d %H:%M}")
    for r in rows:
        print(f"{r['模型']} | {r['情況']} | {r['方法']}：平均差 {r['平均差']} {r['單位']}，"
              f"{r['容許']}內 {r['容許內%']}%（{r['筆數']} 筆）")
    print(f"已寫入 {path}")


if __name__ == "__main__":
    main()
