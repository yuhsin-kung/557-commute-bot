"""tools/尖峰排隊預測557.py 的測試。執行：uv run --with openpyxl --with scikit-learn python -m unittest discover -s tests -p "test_*.py" """
import importlib.util
import os
import unittest
from datetime import datetime, timedelta

try:
    import numpy as np
    HERE = os.path.dirname(os.path.abspath(__file__))
    spec = importlib.util.spec_from_file_location("qpred557", os.path.join(HERE, "..", "tools", "尖峰排隊預測557.py"))
    P = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(P)
    HAS = True
except ImportError:
    HAS = False


def at(hm):
    return datetime.strptime(f"2026-11-25 {hm}", "%Y-%m-%d %H:%M")


def row(hm, red, mrt_q=False):
    """國中 hm 到、2 分鐘後到士林站、再 10 分鐘到東吳"""
    j = at(hm)
    return {"士林國中": j, "捷運士林站": j + timedelta(minutes=2), "東吳": j + timedelta(minutes=12),
            "red": red, "red_at": j + timedelta(minutes=1), "mrt_q": mrt_q}


def label(rows):
    for i, r in enumerate(rows):
        r["jhs_q"] = r["red"] and i + 1 < len(rows) and rows[i + 1]["red"]
    return rows


@unittest.skipUnless(HAS, "沒裝 numpy／scikit-learn")
class QueuePredTest(unittest.TestCase):
    def setUp(self):
        # 11/25 的情況：09:28 綠，09:34、09:40、09:46、09:51 連續紅，09:58 綠
        self.rows = label([row("09:28", False), row("09:34", True), row("09:40", True), row("09:46", True),
                           row("09:51", True), row("09:58", False)])

    def test_red_run_last_one_clears(self):
        self.assertEqual([r["jhs_q"] for r in self.rows], [False, True, True, True, False, False],
                         "連續紅色 4 台：前 3 台要排，最後一台清空")

    def test_truth_team_example(self):
        """09:33 到國中：09:34 要排 → 最快 09:40、最晚 09:51（連續紅色最後一台）"""
        f, lo, hi = P.truth(self.rows, "士林國中", at("09:33"))
        self.assertEqual((f, lo, hi), (at("09:46"), at("09:52"), at("10:03")))
        f, lo, hi = P.truth(self.rows, "士林國中", at("09:50"))
        self.assertTrue(f == lo == hi == at("10:03"), "第一台就是最後一台紅色：上得去")

    def test_red_now(self):
        self.assertTrue(P.red_now(self.rows, at("09:36")))
        self.assertFalse(P.red_now(self.rows, at("09:30")))
        self.assertFalse(P.red_now(self.rows, at("10:30")), "超過 15 分鐘前的不算")

    def test_extra_state_needs_enough_samples(self):
        hist = np.array([[570 + i, 1.0 if i < 3 else 0.0, 6.0, 12.0 if i < 3 else 0.0] for i in range(10)])
        lo, hi, rate, n = P.extra(hist, 575)
        self.assertEqual(n, 10)
        lo, hi, rate, n = P.extra(hist, 575, True)
        self.assertEqual(n, 10, "紅色的只有 3 筆（少於 5）：不分狀態")
        lo, hi, rate, n = P.extra(hist, 575, False)
        self.assertEqual((n, hi), (7, 0.0))

    def test_pick_kth(self):
        sims = [(np.array([3.0]), np.array([12.0])), (np.array([9.0]), np.array([18.0]))]
        self.assertTrue(np.allclose(P.pick_kth(sims, 0, 2, 99), 18))
        self.assertTrue(np.allclose(P.pick_kth(sims, 5, 2, 99), 99))


if __name__ == "__main__":
    unittest.main()
