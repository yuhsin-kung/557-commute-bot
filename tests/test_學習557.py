"""tools/學習557.py 的測試。執行：uv run --with openpyxl --with scikit-learn python -m unittest discover -s tests -p "test_*.py"
資料整理的部分不需要 sklearn；模型的測試沒裝 sklearn 就跳過"""
import importlib.util
import os
import unittest
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("learn557", os.path.join(HERE, "..", "tools", "學習557.py"))
L = importlib.util.module_from_spec(spec)
spec.loader.exec_module(L)
mon = L.mon

try:
    import sklearn  # noqa: F401
    HAS_SK = True
except ImportError:
    HAS_SK = False


def at(hm, day="2026-11-25"):
    return datetime.strptime(f"{day} {hm}", "%Y-%m-%d %H:%M")


def bus(mrt, ride, vid="1", day="2026-11-25"):
    m = at(mrt, day)
    return {"車牌": "EAA-" + vid, "車輛ID": vid, "東吳": m + timedelta(minutes=ride),
            "到站": {"士林站": m, "士林國中": m - timedelta(minutes=3)}, "剩位": {"士林站": 40, "士林國中": 50}}


class PositionTest(unittest.TestCase):
    def test_return_stops_come_before_outbound(self):
        """一圈的位置：回程的站在前、去程的站在後，士林站在去程裡"""
        self.assertLess(L.POS[(1, mon.R_MRT)], L.POS[(0, mon.JHS)])
        self.assertLess(L.POS[(0, mon.JHS)], L.MRT_POS)
        self.assertLess(L.MRT_POS, L.POS[(0, mon.SCHOOL)])

    def test_state_uses_last_report_and_drops_stale(self):
        xs = [(at("08:00"), 3), (at("08:04"), 4)]
        self.assertEqual(L.state(xs, at("08:05")), (at("08:04"), 4))
        self.assertIsNone(L.state(xs, at("07:59")))
        self.assertIsNone(L.state(xs, at("08:20")), "超過 10 分鐘沒回報，不知道在哪")

    def test_mrt_arrivals_one_per_trip(self):
        """同一趟到站、離站兩筆只算一次；隔一圈再來算第二趟"""
        ev = {"1": [(at("08:00"), L.MRT_POS), (at("08:01"), L.MRT_POS), (at("09:05"), L.MRT_POS)]}
        self.assertEqual(L.mrt_arrivals(ev)["1"], [at("08:00"), at("09:05")])

    def test_position_samples_target_is_next_mrt_arrival(self):
        ev = {"1": [(at("07:50"), L.MRT_POS - 2), (at("07:58"), L.MRT_POS)]}
        X, y = L.position_samples(ev, L.mrt_arrivals(ev), [], at("07:52"), at("07:52"))
        self.assertEqual(len(X), 1)
        self.assertEqual(X[0][0], L.MRT_POS - 2)
        self.assertAlmostEqual(X[0][1], 2)   # 2 分鐘前回報
        self.assertAlmostEqual(y[0], 6)      # 6 分鐘後到士林站

    def test_position_samples_skip_monitoring_gap(self):
        ev = {"1": [(at("07:50"), L.MRT_POS - 2), (at("08:30"), L.MRT_POS)]}
        day = L.p.Day([])
        day.gaps = [(at("08:00"), at("08:20"))]
        X, _ = L.position_samples(ev, L.mrt_arrivals(ev), day, at("07:52"), at("07:52"))
        self.assertEqual(X, [], "等的那段監測斷了，不知道中間有沒有別的車")


class FeatureTest(unittest.TestCase):
    def test_ride_samples(self):
        X, y = L.ride_samples([bus("08:00", 14)])
        self.assertEqual(X, [[480, at("08:00").weekday()]])
        self.assertEqual(y, [14])

    def test_crowd_rows_skip_cleared_and_chain_previous(self):
        def trip(hm, n, bad=False, gap=""):
            c = lambda k: {"車上人數": str(k)}
            return {"參考": at(hm), "士林站人數": c(n), "國中人數": c(n - 10), "人數不可信": bad, "間隔": gap}
        rows = L.crowd_rows([trip("08:00", 50), trip("08:05", 90, bad=True), trip("08:10", 30, gap=10.0)])
        self.assertEqual([r["y"] for r in rows], [50, 30], "人數被清掉的班不用")
        self.assertEqual(rows[1]["prev"], 50)
        self.assertEqual(rows[1]["head"], 10.0)
        self.assertEqual(rows[1]["jhs"], 20)

    def test_fit_beta_through_origin(self):
        self.assertAlmostEqual(L.fit_beta([(1, 0.8), (2, 1.6), (-1, -0.8)]), 0.8)
        self.assertEqual(L.fit_beta([]), 0.0)

    def test_today_delay_uses_last_arrived_bus_and_other_days(self):
        """平常 08:00 開 10 分（另一天）；今天 07:50 那班開了 14 分、08:04 已到東吳 → 08:10 到士林站的車，今天慢 4 分"""
        today, other = "2026-11-26", "2026-11-25"
        buses = {other: [bus("07:50", 10, vid="a", day=other)],
                 today: [bus("07:50", 14, vid="b", day=today), bus("08:10", 15, vid="c", day=today)]}
        self.assertAlmostEqual(L.today_delay(buses, today, buses[today][1], set()), 4)
        self.assertIsNone(L.today_delay(buses, today, buses[today][0], set()), "還沒有車開到東吳，不知道今天塞不塞")
        self.assertIsNone(L.today_delay(buses, today, buses[today][1], {other}), "平常的資料不能用考卷那天")

    def test_site_next_only_fresh(self):
        etas = [(at("08:00"), 300)]
        self.assertEqual(L.site_next(etas, at("08:00")), at("08:05"))
        self.assertIsNone(L.site_next(etas, at("08:03")), "超過 1 分鐘的預估不用")

    def test_score(self):
        s = L.score([1, -2, 4, -5], tol=3)
        self.assertEqual(s, {"平均差": 3.0, "容許內%": 50, "筆數": 4})


@unittest.skipUnless(HAS_SK, "沒裝 scikit-learn")
class ModelTest(unittest.TestCase):
    def test_ride_model_learns_peak(self):
        """早上 08:00 車程約 15 分、其他時間約 9 分：機器學習要比固定車程準
        （加一點雜訊：每班剛好一樣的話，絕對誤差損失的梯度全是 0，模型學不動；真實資料不會這樣）"""
        import random
        rnd = random.Random(0)
        buses = {}
        for d in ("2026-11-25", "2026-11-26", "2026-11-27"):
            buses[d] = [bus(f"{h:02d}:{m:02d}", (15 if h == 8 else 9) + rnd.uniform(-0.5, 0.5), vid=f"{h}{m}", day=d)
                        for h in range(7, 12) for m in range(0, 60, 6)]
        out = L.exam_ride(buses, ["2026-11-26"])
        mae = lambda k: sum(map(abs, out[("全天", k)])) / len(out[("全天", k)])
        self.assertLess(mae("機器學習"), mae("固定車程"))
        self.assertLess(mae("機器學習"), 1)

    def test_crowd_model_uses_jhs_count(self):
        """離開士林站人數 = 國中人數 + 10：知道國中人數的模型要比只看時段準"""
        import random
        rnd = random.Random(0)
        rows = {}
        for d in ("2026-11-25", "2026-11-26"):
            rows[d] = []
            for i in range(80):
                j = rnd.randint(5, 50)
                rows[d].append({"tod": 420 + i * 5, "wd": 2, "head": 8.0, "prev": 30, "jhs": j, "y": j + 10})
        out = L.exam_crowd(rows, ["2026-11-26"])
        mae = lambda k: sum(map(abs, out[k])) / len(out[k])
        self.assertLess(mae("機器學習（車快到，知道國中人數）"), mae("同時段歷史"))


if __name__ == "__main__":
    unittest.main()
