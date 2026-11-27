"""tools/回程排隊預測557.py 的測試。執行：uv run --with openpyxl --with scikit-learn python -m unittest discover -s tests -p "test_*.py" """
import importlib.util
import os
import unittest
from datetime import datetime, timedelta

try:
    import numpy as np
    HERE = os.path.dirname(os.path.abspath(__file__))
    spec = importlib.util.spec_from_file_location("ret557", os.path.join(HERE, "..", "tools", "回程排隊預測557.py"))
    R = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(R)
    HAS = True
except ImportError:
    HAS = False


def at(hm):
    return datetime.strptime(f"2026-11-24 {hm}", "%Y-%m-%d %H:%M")


def ret(hm, cnt):
    return {"dep": at(hm), "arr": at(hm) + timedelta(minutes=8), "cnt": cnt}


@unittest.skipUnless(HAS, "沒裝 numpy／scikit-learn")
class ReturnQueueTest(unittest.TestCase):
    def setUp(self):
        # 11/24 傍晚：17:00 68、17:04 61、17:13 57、17:22 65、17:25 65、17:36 55
        self.rows = R.label([ret("17:00", 68), ret("17:04", 61), ret("17:13", 57), ret("17:22", 65), ret("17:25", 65), ret("17:36", 55)])

    def test_label_59_rule(self):
        self.assertEqual([r["q"] for r in self.rows], [True, False, False, True, False, False],
                         "59 人以上連續：17:00、17:04 → 只有 17:00 要排；17:22、17:25 → 只有 17:22 要排")

    def test_label_unknown_count_is_not_full(self):
        rows = R.label([ret("12:00", 62), ret("12:10", None), ret("12:20", 63)])
        self.assertEqual([r["q"] for r in rows], [False, False, False])

    def test_truth(self):
        f, lo, hi = R.truth(self.rows, at("16:58"))
        self.assertEqual((f, lo, hi), (at("17:08"), at("17:12"), at("17:12")), "17:00 要排：最快、最晚都是 17:04")
        f, lo, hi = R.truth(self.rows, at("17:10"))
        self.assertTrue(f == lo == hi == at("17:21"), "17:13 不用排")
        self.assertIsNone(R.truth(self.rows, at("17:40")), "後面沒車")

    def test_ride_at_uses_nearby_time(self):
        table = np.array([[1020 + i, 8.0] for i in range(5)] + [[720, 15.0]])
        self.assertEqual(R.ride_at(table, 1025), 8.0)
        self.assertEqual(R.ride_at(table, 900), 8.0, "附近沒有：用全部的中位數")

    def test_kth_departure(self):
        sims = [(np.array([2.0]), np.array([10.0])), (np.array([6.0]), np.array([15.0]))]
        d, a = R.kth_departure(sims, 0, 2, 99)
        self.assertTrue(np.allclose(d, 6) and np.allclose(a, 15))
        d, a = R.kth_departure(sims, 3, 2, 99)
        self.assertTrue(np.allclose(d, 99) and np.isnan(a).all())


if __name__ == "__main__":
    unittest.main()
