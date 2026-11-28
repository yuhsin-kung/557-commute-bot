# /// script
# dependencies = ["openpyxl", "scikit-learn", "numpy"]
# ///
"""Bot 的「預估到達時間」真的準嗎：拿試算表的「預估紀錄」跟同一天的 557 監測資料對答案（試辦數據）。

用法：
  1. 那天照常開 557 監測（tools/557監測.py），資料在 data/557監測/
  2. 試算表的「預估紀錄」分頁 → 檔案 → 下載 → CSV，存成 預測紀錄/預估紀錄_日期.csv（例：預估紀錄_2026-11-30.csv）
  3. uv run tools/對答案預估紀錄557.py 預測紀錄/預估紀錄_2026-11-30.csv

對法（只對 557 這一段：學生「幾點到站牌」是 Bot 算的，實際有沒有那時候到，網站資料看不到）：
  實際＝那個站牌、那個時刻之後：第一台不用排就搭它；第一台要排 → 最快搭下一台、最晚搭第一台不用排的車
       （士林站用團隊顏色規則；士林國中用「連續紅色前 k−1 台要排」，跟 tools/尖峰排隊預測557.py 一樣）
  離峰（Bot 給一個時間）：跟實際第一台到東吳差幾分
  尖峰（Bot 給範圍）：最晚沒少算（預估最晚 ≥ 實際最晚 − 3 分）、最早沒太晚（預估最早 ≤ 實際最快 + 3 分）
測試模式的紀錄（假裝的時間）不算。
"""
import argparse
import csv
import os
import sys
from datetime import datetime, timedelta

import numpy as np

import importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("qpred557", os.path.join(HERE, "尖峰排隊預測557.py"))
P = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(P)
L, p = P.L, P.p

STOP = {"捷運士林站": "捷運士林站", "士林國中": "士林國中"}
TOL = 3


def read_log(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        return [r for r in csv.DictReader(f)]


def when(text):
    """「出門 2026-11-30 08:22／到站牌 2026-11-30 08:39」或「2026-11-30 09:41」→ 最後一個時間"""
    parts = [t for t in text.replace("／", " ").split() if len(t) == 5 and t[2] == ":"]
    days = [t for t in text.replace("／", " ").split() if len(t) == 10 and t[4] == "-"]
    return datetime.strptime(days[-1] + " " + parts[-1], "%Y-%m-%d %H:%M") if parts and days else None


def check(rows, data_dir):
    by_day, out = {}, []
    for r in rows:
        if r.get("測試模式（假裝的時間）") or r["推薦站牌"] not in STOP or not r["預估到東吳（最早）"]:
            continue
        at = when(r["出發／到站牌"].split("到站牌")[-1])
        early, late = when(r["預估到東吳（最早）"]), when(r["預估到東吳（最晚）"]) if r["預估到東吳（最晚）"] else None
        day = at.strftime("%Y-%m-%d")
        if day not in by_day:
            try:
                by_day[day] = P.stop_rows(L.load_trips(day, data_dir), p.load_day(day, data_dir))
            except (FileNotFoundError, SystemExit):  # 那天沒跑監測
                by_day[day] = None
        if not by_day[day]:
            out.append((r, None, "那天沒有監測資料"))
            continue
        tr = P.truth(by_day[day], STOP[r["推薦站牌"]], at)
        if not tr:
            out.append((r, None, "45 分鐘內沒有車，或監測斷掉"))
            continue
        first, lo, hi = tr
        mins = lambda a, b: (a - b).total_seconds() / 60
        res = {"實際第一台": first, "實際最快": lo, "實際最晚": hi, "第一台要排": hi > first,
               "離峰差": None if late else mins(early, first),
               "最晚沒少算": None if not late else late >= hi - timedelta(minutes=TOL),
               "最早沒太晚": None if not late else early <= lo + timedelta(minutes=TOL)}
        out.append((r, res, ""))
    return out


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("log")
    ap.add_argument("--data", default=p.DATA_DIR)
    a = ap.parse_args()
    out = check(read_log(a.log), a.data)
    ok = [(r, x) for r, x, why in out if x]
    for r, x, why in out:
        if not x:
            print(f"跳過：{r['出發／到站牌']}（{why}）")
    off = [abs(x["離峰差"]) for _, x in ok if x["離峰差"] is not None]
    peak = [x for _, x in ok if x["最晚沒少算"] is not None]
    print(f"\n對得到答案的預估 {len(ok)} 筆（離峰 {len(off)}、尖峰 {len(peak)}）")
    if off:
        print(f"離峰：跟實際第一台平均差 {np.mean(off):.1f} 分，3 分內 {100 * np.mean(np.array(off) <= TOL):.0f}%")
    if peak:
        print(f"尖峰：最晚沒少算 {100 * np.mean([x['最晚沒少算'] for x in peak]):.0f}%、最早沒太晚 {100 * np.mean([x['最早沒太晚'] for x in peak]):.0f}%、"
              f"第一台要排 {100 * np.mean([x['第一台要排'] for x in peak]):.0f}%")


if __name__ == "__main__":
    main()
