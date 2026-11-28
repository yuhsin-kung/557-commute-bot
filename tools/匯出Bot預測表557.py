# /// script
# dependencies = ["openpyxl", "scikit-learn", "numpy"]
# ///
"""把監測資料整理成 Bot 用的 557 預測表（bot/預測表557.gs）。

Bot 在 Apps Script 上，跑不了 Python 的零件模型；學生多半是在家、搭捷運前查（到站牌前 10 分鐘以上），
這時四天考試裡最準的本來就是「歷史統計」（v0／零件＋v0 平均），所以把歷史統計做成表放進 Bot。

每個上車站（捷運士林站、士林國中）、07:00–18:30 每 5 分鐘一格，用監測那幾天、前後 10 分鐘每一分鐘到站牌算：
  第一台：到東吳要幾分（從到站牌算起）的中位數、P80
  要排隊（照團隊規則；士林站用顏色規則，國中用「連續紅色前 k−1 台」）：
    第一台要排的比例、最晚（第一台不用排的車）到東吳要幾分的 P80
Bot：離峰給「到站牌＋第一台中位數」一個時間；尖峰給範圍「第一台中位數 ～ 最晚 P80」。
另外一張 P557_BUS（以車為主，11/28）：到站牌後第一台、下一台大概幾點來，搭上各自幾點到東吳（P20～P80）。

  uv run tools/匯出Bot預測表557.py
"""
import argparse
import json
import os
import sys
from datetime import timedelta

import numpy as np

import importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("qpred557", os.path.join(HERE, "尖峰排隊預測557.py"))
P = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(P)
L, p, Z = P.L, P.p, P.Z

START, END, STEP, WINDOW = 7 * 60, 18 * 60 + 30, 5, 10


def samples(days, data_dir=p.DATA_DIR):
    """{上車站: [(幾點到站牌（分）, 第一台幾分到東吳, 最晚幾分到東吳)]}"""
    out = {s: [] for s in P.STOPS}
    for d in days:
        buses = p.load_day(d, data_dir)
        rows = P.stop_rows(L.load_trips(d, data_dir), buses)
        for stop in P.STOPS:
            go = p.on_day("07:00", d) - timedelta(minutes=WINDOW)
            while go <= p.on_day("18:30", d) + timedelta(minutes=WINDOW):
                tr = P.truth(rows, stop, go)
                first_at = next((r[stop] for r in sorted((r for r in rows if r[stop] and r[stop] >= go), key=lambda r: r[stop])), None)
                if tr and p.seen(buses, go, first_at):
                    f, _, hi = tr
                    out[stop].append((L.tod(go), (f - go).total_seconds() / 60, (hi - go).total_seconds() / 60))
                go += timedelta(minutes=1)
    return {s: np.array(v, float) for s, v in out.items()}


def bus_samples(days, data_dir=p.DATA_DIR, stop="捷運士林站"):
    """以車為主（11/28 團隊建議）：到站牌後第一台、下一台幾分鐘來，搭上各要幾分鐘到東吳（都從到站牌算起）。
    同一台車在國中、士林站上車，到東吳的時間一樣，所以只用捷運士林站當基準"""
    out = []
    for d in days:
        buses = p.load_day(d, data_dir)
        seq = sorted((r for r in P.stop_rows(L.load_trips(d, data_dir), buses) if r[stop]), key=lambda r: r[stop])
        go = p.on_day("07:00", d) - timedelta(minutes=WINDOW)
        while go <= p.on_day("18:30", d) + timedelta(minutes=WINDOW):
            nx = [r for r in seq if r[stop] >= go][:2]
            if len(nx) == 2 and nx[0][stop] - go <= p.MAX_WAIT and p.seen(buses, go, nx[1][stop]):
                m = lambda a: (a - go).total_seconds() / 60
                out.append((L.tod(go), m(nx[0][stop]), m(nx[0]["東吳"]), m(nx[1][stop]), m(nx[1]["東吳"])))
            go += timedelta(minutes=1)
    return np.array(out, float)


def bus_table(bs):
    """每 5 分鐘一格：[分鐘, 第一台幾分後來 P20, P80, 搭第一台幾分後到東吳 P20, P80, 下一台幾分後來 P20, P80, 搭下一台到東吳 P20, P80, 樣本數]"""
    rows = []
    for m in range(START, END + 1, STEP):
        x = bs[np.abs(bs[:, 0] - m) <= WINDOW]
        if len(x) < 5:
            continue
        q = lambda col: [round(float(np.percentile(x[:, col], 20)), 1), round(float(np.percentile(x[:, col], 80)), 1)]
        rows.append([m] + q(1) + q(2) + q(3) + q(4) + [len(x)])
    return rows


def table(sm):
    """每 5 分鐘一格：[分鐘, 第一台中位數, 第一台 P80, 第一台要排 %, 最晚 P80, 樣本數]"""
    out = {}
    for stop, x in sm.items():
        rows = []
        for m in range(START, END + 1, STEP):
            near = x[np.abs(x[:, 0] - m) <= WINDOW]
            if len(near) < 5:
                continue
            first, late = near[:, 1], near[:, 2]
            rows.append([m, round(float(np.median(first)), 1), round(float(np.percentile(first, 80)), 1),
                         round(100 * float(np.mean(late > first))), round(float(np.percentile(late, 80)), 1), len(near)])
        out[stop] = rows
    return out


def write_gs(tab, days, path, bus=None):
    peaks = [[a, b] for a, b in Z.OUT_PEAKS]
    bus_body = json.dumps(bus or []).replace("], [", "],\n  [")
    body = json.dumps(tab, ensure_ascii=False).replace("], [", "],\n    [").replace('"捷運士林站": [', '\n  "捷運士林站": [\n    ').replace('"士林國中": [', '\n  "士林國中": [\n    ')
    gs = f"""/**
 * 557 預測表：tools/匯出Bot預測表557.py 自動產生，不要手改（改了重跑程式）。
 * 資料：{'、'.join(d[5:] for d in days)} 的監測（平常日）。
 * 每個上車站、每 5 分鐘一格：[到站牌的時刻（分）, 第一台到東吳幾分（中位數）, 第一台 P80, 第一台要排 %, 最晚到東吳幾分 P80, 樣本數]
 * 「最晚」＝照團隊排隊規則，第一台要排就等到第一台不用排的車。
 */
const P557_PEAKS = {json.dumps(peaks)}; // 往東吳尖峰（分）：07:30–08:00、09:15–10:00
const P557_TABLE = {body};

// 以車為主（捷運士林站當基準；同一台車在國中上車，到東吳時間一樣）：每 5 分鐘一格
// [到站牌的時刻（分）, 第一台幾分後來 P20, P80, 搭第一台幾分後到東吳 P20, P80, 下一台幾分後來 P20, P80, 搭下一台幾分後到東吳 P20, P80, 樣本數]
const P557_BUS = {bus_body};
"""
    with open(path, "w", encoding="utf-8") as f:
        f.write(gs)


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--days", nargs="+", default=L.DAYS)
    ap.add_argument("--data", default=p.DATA_DIR)
    ap.add_argument("--out", default=os.path.join(HERE, "..", "bot", "預測表557.gs"))
    a = ap.parse_args()
    tab = table(samples(a.days, a.data))
    bus = bus_table(bus_samples(a.days, a.data))
    write_gs(tab, a.days, a.out, bus)
    print("以車為主：", len(bus), "格；例：", [r for r in bus if r[0] in (570, 670)])
    for stop, rows in tab.items():
        print(stop, len(rows), "格；例：", [r for r in rows if r[0] in (450, 570, 585)])
    print("已寫入", os.path.abspath(a.out))


if __name__ == "__main__":
    main()
