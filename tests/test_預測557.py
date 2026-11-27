"""tools/預測557.py 的測試。執行：uv run --with openpyxl python -m unittest discover -s tests -p "test_*.py" """
import importlib.util
import os
import tempfile
import unittest
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("predict557", os.path.join(HERE, "..", "tools", "預測557.py"))
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)

DAY = "2026-11-25"


def at(hm, day=DAY):
    return datetime.strptime(f"{day} {hm}", "%Y-%m-%d %H:%M")


def bus(mrt, ride, left=40, jhs_before=3, vid="1", day=DAY, jhs_left=50):
    """一班車：幾點到士林站、士林站到東吳幾分鐘、離開士林站剩幾個位置"""
    m = at(mrt, day)
    return {"車牌": "EAA-" + vid, "車輛ID": vid, "東吳": m + timedelta(minutes=ride),
            "到站": {"士林站": m, "士林國中": m - timedelta(minutes=jhs_before)}, "剩位": {"士林站": left, "士林國中": jhs_left}}


class FirstBusTest(unittest.TestCase):
    def test_skip_full_bus(self):
        """07:41 那班只剩 3 個位置：門檻 5 就跳過，等 07:50 那班"""
        day = [bus("07:41", 10, left=3), bus("07:50", 10, left=30)]
        self.assertEqual(p.first_bus(day, "士林站", at("07:40"), 5)["到站"]["士林站"], at("07:50"))
        self.assertEqual(p.first_bus(day, "士林站", at("07:40"), 3)["到站"]["士林站"], at("07:41"))

    def test_unknown_count_counts_as_ok(self):
        day = [bus("07:41", 10, left=None)]
        self.assertIsNotNone(p.first_bus(day, "士林站", at("07:40"), 20))

    def test_no_bus_within_45_minutes(self):
        self.assertIsNone(p.first_bus([bus("08:30", 10)], "士林站", at("07:40"), 5))


class WaitTest(unittest.TestCase):
    def test_wait_samples_inspection_paradox(self):
        """兩台黏在一起、隔 10 分鐘才下一台：窗口內每分鐘到站要等的時間"""
        day = [bus("08:00", 9), bus("08:01", 9), bus("08:11", 9), bus("08:21", 9)]
        got = p.wait_samples(day, "士林站", at("08:05"), 5, timedelta(minutes=2))
        self.assertEqual(got, [8.0, 7.0, 6.0, 5.0, 4.0])  # 08:03～08:07 到站，都要等 08:11

    def test_bot_estimate(self):
        """Bot：一律 12 分，07:20–08:20、09:00–10:00 再加 10 分"""
        self.assertEqual(p.bot_estimate(at("07:30")), at("07:52"))
        self.assertEqual(p.bot_estimate(at("08:30")), at("08:42"))
        self.assertEqual(p.bot_estimate(at("09:00")), at("09:22"))


class PredictTest(unittest.TestCase):
    def test_predict_regular_schedule(self):
        """每 10 分鐘一班、車程 9 分：08:05 到站 → 等車中位數約 5 分、到東吳約 08:19"""
        day = [bus(f"{h:02}:{m:02}", 9) for h in range(6, 20) for m in range(0, 60, 10)]
        rows = p.predict({DAY: day}, "2026-11-26")
        r = next(r for r in rows if r["站"] == "士林站" and r["到站時間"] == "08:05" and r["空位門檻"] == 10)
        self.assertEqual((r["預測等車(分)"], r["預測車程(分)"], r["預測到東吳"]), (5.0, 9.0, "08:19"))
        self.assertEqual(r["用了哪幾天"], "11-25")
        self.assertEqual(r["Bot估計到東吳"], "08:27", "08:05 是尖峰：12 + 10")

    def test_half_day_only_used_where_it_has_data(self):
        """11/24 只跑了下午：早上的預測不能用它"""
        full = [bus(f"{h:02}:{m:02}", 9) for h in range(6, 20) for m in range(0, 60, 10)]
        half = [bus(f"{h:02}:{m:02}", 9, day="2026-11-24") for h in range(17, 19) for m in range(0, 60, 10)]
        rows = p.predict({DAY: full, "2026-11-24": half}, "2026-11-26")
        used = {r["到站時間"]: r["用了哪幾天"] for r in rows if r["站"] == "士林站" and r["空位門檻"] == 10}
        self.assertEqual(used["08:00"], "11-25")
        self.assertEqual(used["17:30"], "11-25、11-24")

    def test_ride_window_follows_traffic(self):
        """08:00 那幾班車程 15 分、其他 9 分：車程跟著時段走"""
        day = [bus(f"{h:02}:{m:02}", 15 if h == 8 else 9) for h in range(6, 20) for m in range(0, 60, 10)]
        rows = p.predict({DAY: day}, "2026-11-26")
        ride = {r["到站時間"]: r["預測車程(分)"] for r in rows if r["站"] == "士林站" and r["空位門檻"] == 10}
        self.assertEqual((ride["08:25"], ride["11:00"]), (15.0, 9.0))


class EvaluateTest(unittest.TestCase):
    def test_evaluate_against_actual_day(self):
        train = [bus(f"{h:02}:{m:02}", 9) for h in range(6, 20) for m in range(0, 60, 10)]
        target = [bus(f"{h:02}:{m:02}", 12, day="2026-11-26") for h in range(6, 20) for m in range(0, 60, 10)]
        rows = p.predict({DAY: train}, "2026-11-26")
        detail, summary = p.evaluate(rows, target, "2026-11-26")
        d = next(d for d in detail if d["站"] == "士林站" and d["到站時間"] == "11:05" and d["空位門檻"] == 10)
        self.assertEqual((d["預測到東吳"], d["實際到東吳"], d["誤差(分)"]), ("11:19", "11:22", 3.0))
        whole = next(s for s in summary if s["站"] == "士林站" and s["空位門檻"] == 10 and s["時段"] == "全天")
        self.assertEqual(whole["偏晚還是偏早(我們，正的=實際比預測晚)"], 3.0, "實際每班都慢 3 分")

    def test_monitor_gap_not_scored(self):
        """監測斷掉的時段（關機、斷網）：等車那段有斷就不對答案，不會變成「等了一小時」"""
        target = p.Day([bus("17:30", 10, day="2026-11-26"), bus("17:40", 10, day="2026-11-26"),
                        bus("18:50", 10, day="2026-11-26"), bus("19:00", 10, day="2026-11-26")])
        target.gaps = [(at("17:42", "2026-11-26"), at("18:44", "2026-11-26"))]
        self.assertIsNone(p.actual(target, "士林站", at("17:45", "2026-11-26"), 5), "17:45 到站，下一班看起來是 18:50，但中間沒在監測")
        self.assertIsNotNone(p.actual(target, "士林站", at("17:35", "2026-11-26"), 5), "17:40 那班在斷掉前就來了")
        self.assertIsNotNone(p.actual(target, "士林站", at("18:45", "2026-11-26"), 5), "恢復以後照常")
        # 訓練也一樣：斷掉那段不拿來算等車
        self.assertEqual(p.wait_samples(target, "士林站", at("17:50", "2026-11-26"), 5, timedelta(minutes=2)), [])

    def test_load_gaps_from_fetch_times(self):
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, "557_raw_2026-11-26.csv"), "w", encoding="utf-8-sig") as f:
                f.write("事件時間,抓取時間\n")
                for s in ("17:40:00", "17:41:00", "17:42:00", "18:44:00", "18:46:00"):
                    f.write(f"2026-11-26 {s},2026-11-26 {s}\n")
            gaps = p.load_gaps("2026-11-26", d)
        self.assertEqual(gaps[1:-1], [(at("17:42", "2026-11-26"), at("18:44", "2026-11-26"))], "隔 2 分鐘不算斷掉，隔 62 分鐘才算")
        self.assertEqual(gaps[0], (at("00:00", "2026-11-26"), at("17:40", "2026-11-26")), "監測開始以前也算沒資料")
        self.assertEqual(gaps[-1], (at("18:46", "2026-11-26"), at("00:00", "2026-11-27")), "監測結束以後也算沒資料")

    def test_predictions_file_round_trip(self):
        rows = p.predict({DAY: [bus("08:00", 9), bus("08:10", 9)]}, "2026-11-26")
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "x.csv")
            p.write_csv(path, rows, p.PRED_FIELDS, "# 產生時間 測試")
            back = p.read_predictions(path)
        self.assertEqual(len(back), len(rows))
        self.assertEqual(back[0]["站"], rows[0]["站"])


class RealtimeTest(unittest.TestCase):
    def test_matches_the_right_trip_of_the_same_bus(self):
        """同一台車一天跑好幾趟：網站說 08:10 到士林站，要對到 08:10 那趟，不是 17:10 那趟"""
        train = {DAY: [bus(f"{h:02}:{m:02}", 9) for h in range(6, 20) for m in range(0, 60, 10)]}
        target = [bus("08:10", 11, vid="7", day="2026-11-26"), bus("17:10", 9, vid="7", day="2026-11-26")]
        etas = [{"資料時間": "2026-11-26 08:05:00", "站牌ID": p.mon.MRT, "預估秒數": "300", "車輛ID": "7"}]
        rows = p.realtime_case(etas, train, target, "2026-11-26")
        first = next(r for r in rows if r["到站時間"] == "08:05")
        self.assertEqual((first["網站說幾點到站"], first["預測到東吳"], first["實際到東吳"], first["誤差(分)"]),
                         ("08:10", "08:19", "08:21", 2.0))


if __name__ == "__main__":
    unittest.main()
