"""tools/零件模型557.py 的測試。執行：uv run --with openpyxl --with scikit-learn python -m unittest discover -s tests -p "test_*.py" """
import importlib.util
import os
import unittest
from datetime import datetime, timedelta

try:
    import numpy as np
    HERE = os.path.dirname(os.path.abspath(__file__))
    spec = importlib.util.spec_from_file_location("parts557", os.path.join(HERE, "..", "tools", "零件模型557.py"))
    Z = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(Z)
    HAS = True
except ImportError:
    HAS = False


def at(hm):
    return datetime.strptime(f"2026-11-25 {hm}", "%Y-%m-%d %H:%M")


@unittest.skipUnless(HAS, "沒裝 numpy／scikit-learn")
class PartsTest(unittest.TestCase):
    def test_visits_keeps_first_event_per_stop(self):
        xs = [(at("08:00"), 3), (at("08:01"), 3), (at("08:03"), 4), (at("08:04"), 4)]
        self.assertEqual(Z.visits(xs), [(at("08:00"), 3), (at("08:03"), 4)])

    def test_segments_skip_jumps_and_gaps(self):
        vis = {"1": [(at("08:00"), 3), (at("08:03"), 4), (at("08:09"), 6)]}
        segs = Z.segments(vis, [])
        self.assertEqual([(s[0], s[2]) for s in segs], [(3, 3.0)], "跳過一站（4 → 6）的不算")
        day = Z.L.p.Day([])
        day.gaps = [(at("08:01"), at("08:02"))]
        self.assertEqual(Z.segments(vis, day), [], "中間監測斷掉的不算")

    def test_table_uses_nearby_time_or_all_day(self):
        segs = [(3, 480 + i, 10.0, None) for i in range(5)] + [(3, 900 + i, 4.0, None) for i in range(5)]
        t = Z.Table(segs)
        self.assertEqual(t.median(3, 485), 10.0, "08:00 前後用 08:00 的樣本")
        self.assertEqual(t.median(3, 700), 7.0, "附近沒有樣本就用整天")

    def test_today_factor_slower_today(self):
        """平常這段 4 分，今天最近跑完的都 6 分 → 倍率大於 1，但樣本少會往 1 拉"""
        table = Z.Table([(3, 480 + i, 4.0, None) for i in range(10)])
        today = [(3, 480, 6.0, at("08:0" + str(i))) for i in range(8)]
        f = Z.today_factor(today, at("08:10"), table)
        self.assertGreater(f, 1.1)
        self.assertLess(f, 1.5)
        self.assertEqual(Z.today_factor([], at("08:10"), table), 1.0)
        self.assertEqual(Z.today_factor(today, at("09:30"), table), 1.0, "超過 30 分鐘前的不看")

    def test_simulate_and_pick(self):
        """一台車在士林站前一站：模擬到士林站約 3 分、到東吳再約 9 分"""
        segs = []
        for q in range(Z.C):
            segs += [(q, 480 + i, 3.0 if q == Z.MRT - 1 else 1.0, None) for i in range(5)]
        table = Z.Table(segs)
        vis = {"1": [(at("08:00"), Z.MRT - 1)]}
        sims = Z.simulate(vis, at("08:01"), table, 1.0, np.random.default_rng(0), sims=10)
        self.assertEqual(len(sims), 1)
        mrt, school = sims[0]
        self.assertTrue(np.allclose(mrt, 2.0), "已經走了 1 分鐘，再 2 分鐘到士林站")
        self.assertTrue(np.allclose(school - mrt, Z.SCHOOL - Z.MRT), "士林站到東吳每段 1 分")
        self.assertTrue(np.allclose(Z.pick(sims, 0, 99.0, sims=10), school))
        self.assertTrue(np.allclose(Z.pick(sims, 5, 99.0, sims=10), 99.0), "5 分鐘後才到站，這台已經開走 → 用備案")

    def test_simulate_return_board_and_alight(self):
        """回程：車在東吳（去程終點），模擬到錢穆故居（離開東吳）和回程的捷運士林站"""
        table = Z.Table([(q, 480 + i, 2.0 if q == Z.DWELL else 1.0, None) for q in range(Z.C) for i in range(5)])
        vis = {"1": [(at("08:00"), Z.DWELL)]}
        sims = Z.simulate(vis, at("08:00"), table, 1.0, np.random.default_rng(0), sims=5, board=Z.R_BOARD, alight=Z.R_ALIGHT)
        self.assertEqual(len(sims), 1)
        dep, arr = sims[0]
        self.assertTrue(np.allclose(dep, 2.0), "在校內停 2 分鐘才離開")
        self.assertTrue(np.allclose(arr - dep, Z.R_ALIGHT - Z.R_BOARD), "錢穆故居到捷運士林站每段 1 分")

    def test_return_v0_wait_and_ride(self):
        """訓練那天每 10 分鐘一班離開東吳、開 8 分鐘到士林站 → 平均等約 5 分＋8 分"""
        day = "2026-11-25"
        rets = {day: [(at(f"08:{m:02d}"), at(f"08:{m:02d}") + timedelta(minutes=8)) for m in range(0, 60, 10)]}
        pred = Z.return_v0(rets, [day], datetime(2026, 11, 26, 8, 20), {day: []})
        self.assertIsNotNone(pred)
        mins = (pred - datetime(2026, 11, 26, 8, 20)).total_seconds() / 60
        self.assertGreaterEqual(mins, 12)
        self.assertLessEqual(mins, 14)
        self.assertIsNone(Z.return_v0(rets, [day], datetime(2026, 11, 26, 12, 0), {day: []}), "那天這個時間沒有資料")

    def test_must_queue_color_rule(self):
        """團隊定的排隊規則：國中紅 → 要排；士林站綠／黃 → 不用；國中綠／黃、士林站紅 → 60 人以上才要排"""
        c = lambda n, lv: {"車上人數": str(n), "擁擠等級": str(lv)}
        self.assertTrue(Z.must_queue({"國中人數": c(55, 3), "士林站人數": c(61, 3)}))
        self.assertFalse(Z.must_queue({"國中人數": c(30, 2), "士林站人數": c(43, 2)}))
        self.assertFalse(Z.must_queue({"國中人數": c(10, 1), "士林站人數": c(55, 3)}), "紅色但沒到 60 人：都上得去")
        self.assertTrue(Z.must_queue({"國中人數": c(35, 2), "士林站人數": c(62, 3)}))
        self.assertTrue(Z.must_queue({"國中人數": None, "士林站人數": c(64, 3)}))
        self.assertIsNone(Z.must_queue({"國中人數": c(5, 1), "士林站人數": None}), "沒有人數：不知道")
        self.assertIsNone(Z.must_queue({"人數不可信": True, "國中人數": c(55, 3), "士林站人數": c(61, 3)}))

    def test_out_peaks(self):
        self.assertTrue(Z.in_out_peak(at("07:45")))
        self.assertTrue(Z.in_out_peak(at("09:15")))
        self.assertFalse(Z.in_out_peak(at("08:00")))
        self.assertFalse(Z.in_out_peak(at("12:30")), "中午有人排但都上得去，不算尖峰")

    def test_return_peaks(self):
        self.assertTrue(Z.in_return_peak(at("12:10")))
        self.assertTrue(Z.in_return_peak(at("17:59")))
        self.assertFalse(Z.in_return_peak(at("08:00")))

    def test_score_rows_scopes(self):
        out = {(0, "零件模型"): {"2026-11-25": [(1.0, True), (-3.0, False)]}}
        rows = Z.score_rows(out, lambda e: [("全天", e[0])] + ([("回程尖峰", e[0])] if e[1] else []))
        whole = next(r for r in rows if r["範圍"] == "全天" and r["考卷"] == "全部")
        peak = next(r for r in rows if r["範圍"] == "回程尖峰" and r["考卷"] == "全部")
        self.assertEqual((whole["平均差"], whole["筆數"]), (2.0, 2))
        self.assertEqual((peak["平均差"], peak["筆數"]), (1.0, 1))

    def test_simulate_drops_vanished_bus(self):
        table = Z.Table([(q, 480 + i, 1.0, None) for q in range(Z.C) for i in range(5)])
        vis = {"1": [(at("08:00"), 5)]}
        self.assertEqual(Z.simulate(vis, at("08:30"), table, 1.0, np.random.default_rng(0), sims=5), [],
                         "停 30 分鐘還沒到下一站（平常 1 分）：當作退出營運")


if __name__ == "__main__":
    unittest.main()
