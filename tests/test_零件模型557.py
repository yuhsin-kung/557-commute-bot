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

    def test_simulate_drops_vanished_bus(self):
        table = Z.Table([(q, 480 + i, 1.0, None) for q in range(Z.C) for i in range(5)])
        vis = {"1": [(at("08:00"), 5)]}
        self.assertEqual(Z.simulate(vis, at("08:30"), table, 1.0, np.random.default_rng(0), sims=5), [],
                         "停 30 分鐘還沒到下一站（平常 1 分）：當作退出營運")


if __name__ == "__main__":
    unittest.main()
