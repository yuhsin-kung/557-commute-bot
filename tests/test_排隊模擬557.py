"""tools/排隊模擬557.py 的測試。執行：uv run --with openpyxl --with scikit-learn python -m unittest discover -s tests -p "test_*.py" """
import importlib.util
import os
import unittest
from datetime import datetime, timedelta

try:
    import numpy as np
    HERE = os.path.dirname(os.path.abspath(__file__))
    spec = importlib.util.spec_from_file_location("queue557", os.path.join(HERE, "..", "tools", "排隊模擬557.py"))
    Q = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(Q)
    HAS = True
except ImportError:
    HAS = False


def at(hm):
    return datetime.strptime(f"2026-11-25 {hm}", "%Y-%m-%d %H:%M")


def bus(hm, jhs, mrt, full):
    return {"v": hm, "a": at(hm), "東吳": at(hm) + timedelta(minutes=9), "jhs": jhs, "jhs_at": at(hm) - timedelta(minutes=2),
            "mrt": mrt, "full": full}


@unittest.skipUnless(HAS, "沒裝 numpy／scikit-learn")
class QueueTest(unittest.TestCase):
    def test_arrival_rate_uses_only_cleared_pairs(self):
        """前一班不用排：這班淨上車 ÷ 間隔；前一班要排的那對不算（上車的包含前面沒擠上的人）"""
        rows = [bus("08:00", 10, 20, False), bus("08:10", 10, 40, False), bus("08:20", 50, 64, True), bus("08:30", 10, 64, True)]
        lam = Q.arrival_rates([rows])
        self.assertAlmostEqual(lam[Q.slot_of(at("08:05"))], (30 + 14) / 20)

    def test_expected_arrivals_crosses_slots_and_peak_kappa(self):
        lam = {s: 1.0 for s in range(96)}
        lam[Q.slot_of(at("08:15"))] = 3.0
        self.assertAlmostEqual(Q.expected_arrivals(lam, at("08:10"), at("08:20")), 5 * 1 + 5 * 3)
        self.assertAlmostEqual(Q.expected_arrivals(lam, at("07:40"), at("07:50"), kappa=2.0), 20, msg="尖峰乘 κ")
        self.assertAlmostEqual(Q.expected_arrivals(lam, at("11:00"), at("11:10"), kappa=2.0), 10, msg="離峰不乘")
        self.assertEqual(Q.expected_arrivals(lam, at("08:20"), at("08:10")), 0)

    def test_replay_clears_or_leaves_people(self):
        """每分鐘 3 人：08:00 不用排 → 清空；08:10 要排、位置 15 → 留下 30 − 15 = 15 人"""
        lam = {s: 3.0 for s in range(96)}
        rows = [bus("08:00", 10, 30, False), bus("08:10", 50, 65, True)]
        q, last = Q.replay(rows, lam, at("08:12"))
        self.assertAlmostEqual(q, 15)
        self.assertEqual(last, at("08:10"))
        q, _ = Q.replay(rows, lam, at("08:05"))
        self.assertAlmostEqual(q, 0, msg="08:10 那班還沒開走：只算到 08:00")

    def test_queue_sim_student_behind_queue_waits(self):
        """前面 20 人、第一班只剩 10 位 → 學生搭第二班；排最後面也是第二班清空隊伍"""
        lam = {s: 0.0 for s in range(96)}
        sims = 4
        cands = [(np.full(sims, 3.0), np.full(sims, 12.0), np.full(sims, 10.0)),
                 (np.full(sims, 9.0), np.full(sims, 18.0), np.full(sims, 30.0))]
        out, ff, ahead, worst = Q.queue_sim(cands, 20, at("09:30"), 0, lam, 1.0, np.random.default_rng(0), 99.0, sims=sims)
        self.assertTrue(np.allclose(out, 18.0))
        self.assertTrue(ff.all(), "第一班位置不夠：要排")
        self.assertTrue(np.allclose(ahead, 20))
        self.assertTrue(np.allclose(worst, 18.0))
        out, ff, _, _ = Q.queue_sim(cands, 5, at("09:30"), 0, lam, 1.0, np.random.default_rng(0), 99.0, sims=sims)
        self.assertTrue(np.allclose(out, 12.0), "前面 5 人、10 個位置：第一班就上")
        self.assertFalse(ff.any())

    def test_queue_sim_no_bus_uses_fallback(self):
        out, _, _, worst = Q.queue_sim([], 0, at("09:30"), 0, {}, 1.0, np.random.default_rng(0), 42.0, sims=3)
        self.assertTrue(np.allclose(out, 42.0) and np.allclose(worst, 42.0))

    def test_poisson_cdf(self):
        self.assertAlmostEqual(Q._poisson_cdf(0, 2.0), np.exp(-2))
        self.assertEqual(Q._poisson_cdf(-1, 2.0), 0.0)
        self.assertGreater(Q._poisson_cdf(20, 2.0), 0.999)


if __name__ == "__main__":
    unittest.main()
