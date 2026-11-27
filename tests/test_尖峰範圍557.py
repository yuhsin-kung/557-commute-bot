"""tools/尖峰範圍557.py 的測試。執行：uv run --with openpyxl --with scikit-learn python -m unittest discover -s tests -p "test_*.py" """
import importlib.util
import os
import unittest
from datetime import datetime, timedelta

try:
    import numpy as np
    HERE = os.path.dirname(os.path.abspath(__file__))
    spec = importlib.util.spec_from_file_location("range557", os.path.join(HERE, "..", "tools", "尖峰範圍557.py"))
    R = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(R)
    HAS = True
except ImportError:
    HAS = False


def at(hm):
    return datetime.strptime(f"2026-11-25 {hm}", "%Y-%m-%d %H:%M")


def bus(hm, full):
    return {"a": at(hm), "東吳": at(hm) + timedelta(minutes=9), "full": full}


@unittest.skipUnless(HAS, "沒裝 numpy／scikit-learn")
class RangeTest(unittest.TestCase):
    def test_truth_first_and_first_clear(self):
        rows = [bus("09:34", True), bus("09:40", True), bus("09:58", False)]
        self.assertEqual(R.truth(rows, at("09:29")), (at("09:43"), at("10:07")), "第一班 09:34，第一台不用排的是 09:58")
        self.assertEqual(R.truth(rows, at("09:50")), (at("10:07"), at("10:07")), "第一班就不用排：範圍只有一點")
        self.assertIsNone(R.truth(rows, at("10:00")), "後面沒車")

    def test_pick_kth(self):
        sims = [(np.array([3.0, 3.0]), np.array([12.0, 12.0])), (np.array([9.0, 9.0]), np.array([18.0, 18.0]))]
        self.assertTrue(np.allclose(R.pick_kth(sims, 0, 1, 99), 12))
        self.assertTrue(np.allclose(R.pick_kth(sims, 0, 2, 99), 18))
        self.assertTrue(np.allclose(R.pick_kth(sims, 5, 1, 99), 18), "5 分鐘後到站：第一台已經開走")
        self.assertTrue(np.allclose(R.pick_kth(sims, 5, 2, 99), 99), "沒有第二台：用備案")

    def test_color_rates_and_known_first(self):
        def b(hm, full, lv, left):
            return {"a": at(hm), "東吳": at(hm) + timedelta(minutes=9), "full": full, "jhs_lv": lv, "jhs_at": at(left)}
        rows = [b("09:34", True, 3, "09:32"), b("09:40", True, 2, "09:38"), b("09:46", False, 1, "09:44"), b("11:00", True, 1, "10:58")]
        self.assertEqual(R.color_rates({"d": rows}), {3: 1.0, 2: 1.0, 1: 0.0}, "只看尖峰的車")
        self.assertIs(R.known_first(rows, at("09:33")), rows[0], "已經離開國中、還沒到士林站")
        self.assertIsNone(R.known_first(rows, at("09:30")), "還沒到國中：不知道顏色")

    def test_extra_uses_nearby_minutes(self):
        gaps = np.array([[570 + i, float(i)] for i in range(11)] + [[700, 50.0]])
        self.assertAlmostEqual(R.extra(gaps, 575), 8.0)
        self.assertEqual(R.extra(np.zeros((0, 2)), 575), 10.0)


if __name__ == "__main__":
    unittest.main()
