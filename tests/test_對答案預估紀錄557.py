"""tools/對答案預估紀錄557.py 的測試。執行：uv run --with openpyxl --with scikit-learn python -m unittest discover -s tests -p "test_*.py" """
import importlib.util
import os
import unittest
from datetime import datetime

try:
    HERE = os.path.dirname(os.path.abspath(__file__))
    spec = importlib.util.spec_from_file_location("check557", os.path.join(HERE, "..", "tools", "對答案預估紀錄557.py"))
    C = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(C)
    HAS = True
except ImportError:
    HAS = False


def row(at, stop, early, late="", test=""):
    return {"測試模式（假裝的時間）": test, "推薦站牌": stop, "出發／到站牌": "到站牌 2026-11-25 " + at,
            "預估到東吳（最早）": "2026-11-25 " + early, "預估到東吳（最晚）": ("2026-11-25 " + late) if late else ""}


@unittest.skipUnless(HAS, "沒裝 numpy／scikit-learn")
class CheckTest(unittest.TestCase):
    def test_when(self):
        self.assertEqual(C.when("出門 2026-11-25 08:22／到站牌 2026-11-25 08:39"), datetime(2026, 11, 25, 8, 39))
        self.assertIsNone(C.when(""))

    def test_check_against_monitoring(self):
        """11/25 的監測資料：09:29 到國中（09:34 那班要排）→ 實際最快搭 09:40 那班（09:48 到東吳）、最晚搭 09:51 那班（10:00 到）"""
        rows = [row("09:29", "士林國中", "09:46", "10:05"), row("08:30", "捷運士林站", "08:42"),
                row("09:29", "士林國中", "09:46", "10:05", test="週三 09:29")]
        out = C.check(rows, C.p.DATA_DIR)
        self.assertEqual(len(out), 2, "測試模式的不算")
        peak = out[0][1]
        self.assertTrue(peak["第一台要排"])
        self.assertEqual(peak["實際最快"].strftime("%H:%M"), "09:48")
        self.assertEqual(peak["實際最晚"].strftime("%H:%M"), "10:00")
        self.assertTrue(peak["最晚沒少算"])
        off = out[1][1]
        self.assertIsNotNone(off["離峰差"])
        self.assertIsNone(off["最晚沒少算"])

    def test_missing_day(self):
        out = C.check([{**row("09:29", "士林國中", "09:46"), "出發／到站牌": "到站牌 2030-01-01 09:29"}], C.p.DATA_DIR)
        self.assertEqual(out[0][2], "那天沒有監測資料")


if __name__ == "__main__":
    unittest.main()
