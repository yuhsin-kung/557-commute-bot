# /// script
# dependencies = ["openpyxl", "scikit-learn", "numpy", "matplotlib"]
# ///
"""簡報用的機器學習成效圖，存到 design/簡報圖/

  1_誤差比較.png   人已經在站牌：Bot、網站、機器學習、零件模型；車上人數：公平的比較對象 vs 機器學習
                   （數字讀 預測紀錄/557零件模型成績_日期.csv、557機器學習成績_日期.csv）
  2_塞車車程.png   一個早上每班車的實際車程，疊上固定車程、機器學習的預測
  3_實際例子.png   一班車：AI 預測離開士林站車上幾人 vs 實際

  uv run tools/畫圖557.py
"""
import csv
import importlib.util
import os
import statistics
import sys
from datetime import timedelta

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("learn557", os.path.join(HERE, "學習557.py"))
L = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(L)
p = L.p
OUT = os.path.normpath(os.path.join(HERE, "..", "design", "簡報圖"))
SCORES = os.path.join(p.OUT_DIR, "557機器學習成績_2026-11-27.csv")
PARTS = os.path.join(p.OUT_DIR, "557零件模型成績_2026-11-27.csv")
SHOW_DAY = "2026-11-25"  # 折線圖、例子用哪一天（模型用其他天訓練，沒看過這天）

# 顏色：機器學習用藍色強調，比較對象用灰色（資料視覺化預設色票）
INK, INK2, MUTED, GRID, SURFACE = "#0b0b0b", "#52514e", "#8a8984", "#e4e3df", "#fcfcfb"
ML, ML_LIGHT, BASE_DARK, BASE_LIGHT, REAL = "#2a78d6", "#9ec5f4", "#6b6a65", "#b5b4ae", "#0b0b0b"

for f in ("msjh.ttc", "msjhbd.ttc"):
    path = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", f)
    if os.path.exists(path):
        font_manager.fontManager.addfont(path)
plt.rcParams.update({"font.family": ["Microsoft JhengHei", "sans-serif"], "axes.unicode_minus": False,
                     "figure.facecolor": SURFACE, "axes.facecolor": SURFACE, "savefig.facecolor": SURFACE,
                     "axes.edgecolor": GRID, "axes.labelcolor": INK2, "xtick.color": INK2, "ytick.color": INK2,
                     "text.color": INK, "font.size": 13})


def style(ax):
    for s in ("top", "right", "left"):
        ax.spines[s].set_visible(False)
    ax.spines["bottom"].set_color(GRID)
    ax.tick_params(length=0)


def read_scores():
    with open(SCORES, encoding="utf-8-sig", newline="") as f:
        lines = [x for x in f.read().splitlines() if not x.startswith("#")]
    return {(r["模型"], r["情況"], r["方法"]): float(r["平均差"]) for r in csv.DictReader(lines) if r.get("考卷", "全部") == "全部"}


def read_parts():
    with open(PARTS, encoding="utf-8-sig", newline="") as f:
        lines = [x for x in f.read().splitlines() if not x.startswith("#")]
    return {(r["情況"], r["方法"]): r for r in csv.DictReader(lines) if r["考卷"] == "全部"}


def chart_errors(s, z):
    home = [("Bot 現行算法", float(z[("人已經在站牌", "Bot 現行")]["平均差"]), BASE_LIGHT),
            ("網站預估", float(z[("人已經在站牌", "網站下一班")]["平均差"]), BASE_LIGHT),
            ("機器學習（第一版）", float(z[("人已經在站牌", "機器學習（車輛位置）")]["平均差"]), BASE_DARK),
            ("AI 零件模型", float(z[("人已經在站牌", "零件模型")]["平均差"]), ML)]
    crowd = [("同時段歷史", s[("擁擠（離開士林站車上幾人）", "全天", "同時段歷史")], BASE_LIGHT),
             ("國中人數＋歷史上車", s[("擁擠（離開士林站車上幾人）", "全天", "國中人數＋同時段士林站淨上車")], BASE_DARK),
             ("機器學習", s[("擁擠（離開士林站車上幾人）", "全天", "機器學習（車快到，知道國中人數）")], ML)]
    fig, axes = plt.subplots(1, 2, figsize=(13, 4.8))
    for ax, data, title, unit in ((axes[0], home, "人已經在站牌，預測幾點到東吳", "分鐘"),
                                  (axes[1], crowd, "車快到時，預測離開士林站車上幾人", "人")):
        names = [d[0] for d in data][::-1]
        vals = [d[1] for d in data][::-1]
        cols = [d[2] for d in data][::-1]
        bars = ax.barh(names, vals, color=cols, height=0.55, edgecolor=SURFACE, linewidth=2)
        for b, v in zip(bars, vals):
            ax.text(v + max(vals) * 0.02, b.get_y() + b.get_height() / 2, f"{v:.1f} {unit}", va="center", color=INK, fontsize=13)
        ax.set_xlim(0, max(vals) * 1.3)
        ax.set_xticks([])
        ax.set_title(f"{title}\n平均差幾{unit}（越短越準）", loc="left", fontsize=15, color=INK, pad=12)
        style(ax)
        ax.spines["bottom"].set_visible(False)
    bot, web, best = home[0][1], home[1][1], home[3][1]
    fair, ml = crowd[1][1], crowd[2][1]
    axes[0].text(0, -0.9, f"比 Bot 少差 {round((bot - best) / bot * 100)}%、比網站預估少差 {round((web - best) / web * 100)}%",
                 color=ML, fontsize=14, fontweight="bold", transform=axes[0].get_yaxis_transform())
    axes[1].text(0, -0.9, f"比「國中人數＋歷史」少差 {round((fair - ml) / fair * 100)}%", color=ML, fontsize=14, fontweight="bold",
                 transform=axes[1].get_yaxis_transform())
    fig.text(0.01, 0.01, "輪流考試：11/24（只有傍晚）、11/25、11/26、11/27 輪流當考卷，模型沒看過考卷那天。資料：臺北市公車動態網站，每 15 秒記錄。",
             color=MUTED, fontsize=10)
    fig.tight_layout(rect=(0, 0.05, 1, 1))
    fig.savefig(os.path.join(OUT, "1_誤差比較.png"), dpi=200)
    plt.close(fig)


def chart_ride(buses):
    train = [b for d, bs in buses.items() if d != SHOW_DAY for b in bs]
    X, y = L.ride_samples(train)
    model = L.gbr().fit(X, y)
    fixed = statistics.median(y)
    tb, preds, beta = L.ride_predictions(buses, SHOW_DAY)
    keep = [i for i, b in enumerate(tb) if 7 * 60 <= L.tod(b["到站"]["士林站"]) <= 10 * 60]
    day = [tb[i] for i in keep]
    adj = [preds["機器學習＋今天比平常慢多少"][i] for i in keep]
    xs = [L.tod(b["到站"]["士林站"]) for b in day]
    real = [L.ride(b) for b in day]
    grid = list(range(7 * 60, 10 * 60 + 1))
    wd = day[0]["到站"]["士林站"].weekday()
    pred = model.predict([[t, wd] for t in grid])
    fig, ax = plt.subplots(figsize=(13, 5.2))
    ax.axvspan(L.PEAK[0], L.PEAK[1], color=GRID, alpha=0.5, lw=0)
    ax.text(L.PEAK[0] + 1, 1, "塞車時段：再看今天前一班比平常慢多少", color=MUTED, fontsize=11)
    ax.plot(grid, [fixed] * len(grid), color=BASE_DARK, lw=2, ls="--")
    ax.plot(grid, pred, color=ML_LIGHT, lw=2.5)
    pk = [(x, a) for x, a, b in zip(xs, adj, day) if L.in_peak(b)]
    ax.plot([x for x, _ in pk], [a for _, a in pk], color=ML, lw=2.5, marker="o", ms=8, markeredgecolor=SURFACE, markeredgewidth=2, zorder=4)
    ax.text(pk[-1][0] + 3, pk[-1][1] + 0.6, "AI＋今天路況", color=ML, fontsize=13, fontweight="bold")
    ax.scatter(xs, real, s=60, color=REAL, zorder=3, edgecolor=SURFACE, linewidth=2)
    # 兩條線結尾很近，標籤一個放上、一個放下，避免疊在一起
    hi, lo = (fixed, pred[-1]) if fixed >= pred[-1] else (pred[-1], fixed)
    ax.text(grid[-1] + 2, hi + 0.9, f"固定車程 {fixed:.0f} 分" if hi == fixed else "AI（只看幾點）",
            color=INK2, va="center", fontsize=13)
    ax.text(grid[-1] + 2, lo - 0.9, "AI（只看幾點）" if hi == fixed else f"固定車程 {fixed:.0f} 分",
            color=INK2, va="center", fontsize=13)
    peak = max(range(len(real)), key=lambda i: real[i])
    ax.annotate(f"實際 {real[peak]:.0f} 分", (xs[peak], real[peak]), (xs[peak] + 18, real[peak] + 1.2),
                color=INK, fontsize=12, arrowprops=dict(arrowstyle="-", color=MUTED))
    ax.scatter([], [], s=60, color=REAL, label="每班車實際車程")
    ax.legend(loc="upper right", frameon=False, fontsize=12)
    ax.set_xticks(range(7 * 60, 10 * 60 + 1, 30))
    ax.set_xticklabels([f"{t // 60:02d}:{t % 60:02d}" for t in range(7 * 60, 10 * 60 + 1, 30)])
    ax.set_xlim(7 * 60 - 3, 10 * 60 + 32)
    ax.set_ylim(0, max(real) + 4)
    ax.set_ylabel("士林站 → 東吳（分鐘）")
    ax.grid(axis="y", color=GRID, lw=1)
    style(ax)
    m, d = SHOW_DAY[5:7].lstrip("0"), SHOW_DAY[8:].lstrip("0")
    ax.set_title(f"早上塞車時，AI 看今天的路況把車程算長（{m}/{d} 早上，模型沒看過這天）", loc="left", fontsize=15, pad=12)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "2_塞車車程.png"), dpi=200)
    plt.close(fig)


def chart_example(trips):
    cols = ["tod", "wd", "head", "prev", "jhs"]
    tr = [r for d, ts in trips.items() if d != SHOW_DAY for r in L.crowd_rows(ts)]
    model = L.gbr().fit([[r[c] for c in cols] for r in tr], [r["y"] for r in tr])
    te = [r for r in L.crowd_rows(trips[SHOW_DAY]) if r["jhs"] == r["jhs"] and r["head"] == r["head"] and r["prev"] == r["prev"]]
    for r in te:
        r["pred"] = float(model.predict([[r[c] for c in cols]])[0])
    # 挑早上、實際很擠、預測也接近的一班當例子（說明用，整體準度看圖 1）
    cand = [r for r in te if r["tod"] < 10 * 60 and r["y"] >= 55]
    r = min(cand, key=lambda r: abs(r["pred"] - r["y"]))
    hm = f"{int(r['tod']) // 60:02d}:{int(r['tod']) % 60:02d}"
    cap = L.mon.CAPACITY
    fig, ax = plt.subplots(figsize=(13, 4.4))
    rows = [("離開士林國中時", r["jhs"], BASE_LIGHT), ("AI 預測離開士林站", r["pred"], ML), ("實際離開士林站", r["y"], REAL)]
    for i, (name, v, c) in enumerate(rows[::-1]):
        ax.barh(i, cap, color=GRID, height=0.5)
        ax.barh(i, v, color=c, height=0.5)
        ax.text(-1.5, i, name, ha="right", va="center", fontsize=14, color=INK)
        ax.text(v + 1, i, f"{v:.0f} 人", va="center", fontsize=14, color=INK, fontweight="bold" if c == ML else "normal")
    ax.text(cap, 2.55, f"約 {cap} 人就滿", ha="right", fontsize=11, color=MUTED)
    ax.set_xlim(-0.5, cap + 12)
    ax.set_ylim(-0.6, 2.9)
    ax.axis("off")
    m, d = SHOW_DAY[5:7].lstrip("0"), SHOW_DAY[8:].lstrip("0")
    fig.text(0.2, 0.9, f"實際例子：{m}/{d} {hm} 這班，前一班隔 {r['head']:.0f} 分鐘、前一班 {r['prev']:.0f} 人", fontsize=15, color=INK)
    fig.text(0.2, 0.1, f"→ Bot 可以提醒：「這班到士林站約 {r['pred']:.0f} 人、快滿了，可以去士林國中排或等下一班」",
             fontsize=14, color=ML, fontweight="bold")
    fig.text(0.2, 0.025, f"這是挑出來說明的一班（模型沒看過這天）；這天全部的班平均差 {L.statistics.mean([abs(x['pred'] - x['y']) for x in te]):.1f} 人。"
             f"「滿」以 {cap} 人算，實測早上約 64–66 人就擠不上。", fontsize=10, color=MUTED)
    fig.subplots_adjust(left=0.2, right=0.97, top=0.82, bottom=0.24)
    fig.savefig(os.path.join(OUT, "3_實際例子.png"), dpi=200)
    plt.close(fig)
    return r


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    os.makedirs(OUT, exist_ok=True)
    chart_errors(read_scores(), read_parts())
    buses = {d: p.load_day(d) for d in L.DAYS}
    chart_ride(buses)
    r = chart_example({d: L.load_trips(d) for d in L.DAYS})
    print(f"例子：{r}")
    print(f"已存到 {OUT}")


if __name__ == "__main__":
    main()
