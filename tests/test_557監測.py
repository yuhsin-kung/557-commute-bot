"""tools/557監測.py 的測試。執行：uv run --with openpyxl python -m unittest discover -s tests -p "test_*.py" """
import importlib.util
import os
import tempfile
import unittest
from datetime import datetime

from openpyxl import load_workbook

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("monitor", os.path.join(HERE, "..", "tools", "557監測.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def a2(vid, direction, stop, kind, ts):
    return f"A2,16381,{vid},1,0,158480,{direction},{stop},{kind},{ts[6:]},2,{ts},0,{ts},0"


def a3(vid, stop, riders, level, ts):
    return f"A3,16381,{vid},158480,{stop},{riders},{level},{ts},0,{ts},0"


def snapshot(*buses):
    return {"UpdateTime": "x", "Stop": [], "Bus": [dict(id=b[0], num=b[1], type="1", a2=b[2], a3=b[3]) for b in buses]}


def run(snapshots):
    """依序餵幾次抓到的資料，跟監測主迴圈一樣去重複"""
    events, crowds, se, sc = [], [], set(), set()
    for snap in snapshots:
        e, c = m.parse(snap, datetime(2026, 11, 25, 8, 0))
        for x in e:
            if m.event_key(x) not in se:
                se.add(m.event_key(x)); events.append(x)
        for x in c:
            if m.crowd_key(x) not in sc:
                sc.add(m.crowd_key(x)); crowds.append(x)
    return events, crowds


# 一台車一趟：07:40 天文館發車，沿途每站；07:50 到士林國中（進站 18 人、離站 20 人）；
# 07:53 到士林站（進站 20 人、離站 55 人）；08:05 到東吳
def trip_events(vid="1", num="EAA-001"):
    steps = [
        (m.START, "1", "073800", None), (m.START, "0", "074000", None),
        ("212024", "1", "074030", None), ("212024", "0", "074040", None),
        ("171175", "1", "074300", ("171175", 18, 1, "074320")), ("171175", "0", "074310", ("171175", 18, 1, "074320")),
        ("187538", "1", "074600", None), ("187538", "0", "074630", None),
        (m.JHS, "1", "075000", (m.JHS, 18, 1, "075002")), (m.JHS, "0", "075100", (m.JHS, 20, 1, "075120")),
        (m.MRT, "1", "075300", (m.MRT, 20, 1, "075302")), (m.MRT, "0", "075400", None),
        ("171190", "1", "075500", (m.MRT, 55, 3, "075425")),
        (m.SCHOOL, "1", "080500", ("171195", 50, 3, "080300")),
        ("171164", "0", "081000", None),  # 開始返程
    ]
    out, last3 = [], ""
    for stop, kind, hms, crowd in steps:
        if crowd:
            last3 = a3(vid, crowd[0], crowd[1], crowd[2], "261125" + crowd[3])
        direction = "1" if stop == "171164" else "0"
        out.append((vid, num, a2(vid, direction, stop, kind, "261125" + hms), last3))
    return out


TRIP = trip_events()


class ParseTest(unittest.TestCase):
    def test_parse_real_snapshot(self):
        """2026/11/24 從網站抓的真實資料：7 台車都解析得出位置和人數"""
        import json
        with open(os.path.join(HERE, "fixtures", "557動態.json"), encoding="utf-8") as f:
            events, crowds = m.parse(json.load(f), datetime(2026, 11, 24, 16, 17))
        self.assertEqual(len(events), 7)
        self.assertEqual(len(crowds), 7)
        c = next(c for c in crowds if c["車牌"] == "EAA-057")
        self.assertEqual((c["站牌ID"], c["車上人數"], c["擁擠等級"], c["回報時間"]), ("171175", "56", "3", "2026-11-24 16:16:05"))

    def test_level_fallback(self):
        """網站沒給等級（0）時用網頁的換算：>32 擁擠、>22 中等"""
        mk = lambda n, lv: {"車上人數": str(n), "擁擠等級": str(lv)}
        self.assertEqual([m.level_of(mk(n, 0)) for n in (22, 23, 32, 33)], [1, 2, 2, 3])
        self.assertEqual(m.level_of(mk(10, 3)), 3, "網站有給就照網站")

    def test_skip_test_buses_and_bad_rows(self):
        events, crowds = m.parse(snapshot(("9", "TEST-1", a2("9", "0", m.MRT, "1", "261125075300"), ""),
                                          ("8", "EAA-8", "A2,壞掉", "A3,1,8,0,171189,abc,1,261125075300")), datetime.now())
        self.assertEqual((events, crowds), ([], []))


class TripTest(unittest.TestCase):
    def test_one_trip(self):
        events, crowds = run([snapshot(b) for b in TRIP])
        [t] = m.build_trips(events, crowds)
        self.assertEqual(t["發車"], datetime(2026, 11, 25, 7, 40), "天文館用離站時間當發車")
        at = {m.SHORT[k]: v.strftime("%H:%M:%S") for k, v in t["時間"].items() if k in m.SHORT}
        self.assertEqual(at, {"科教館": "07:40:30", "士林高商": "07:43:00", "行政中心": "07:46:00",
                              "士林國中": "07:50:00", "士林站": "07:53:00", "東吳": "08:05:00"})
        got = {k: t[k]["車上人數"] for k, _ in m.CROWD_POINTS}
        self.assertEqual(got, {"國中到站人數": "18", "國中人數": "20", "士林站到站人數": "20", "士林站人數": "55"})
        self.assertEqual(t["備註"], [])

    def test_missing_crowd_is_marked_not_guessed(self):
        """沒回報士林站人數就留空並註記，不拿別站的數字代替"""
        events, crowds = run([snapshot(b) for b in TRIP[:12]])
        [t] = m.build_trips(events, crowds)
        self.assertIsNone(t["士林站人數"])
        self.assertIn("沒有人數：離開士林站", t["備註"])
        self.assertEqual(t["士林站到站人數"]["車上人數"], "20", "進站那次還是有")

    def test_missed_start_departure_uses_next_stop(self):
        """天文館離站沒抓到（只差 10 秒）：發車用科教館時間，天文館→科教館那格留空"""
        events, crowds = run([snapshot(b) for b in TRIP if b[2].split(",")[7:9] != [m.START, "0"]])
        [t] = m.build_trips(events, crowds)
        self.assertEqual(t["發車"], datetime(2026, 11, 25, 7, 40, 30))
        self.assertIn("天文館離站沒抓到，發車用國立科教館的時間（兩站約差 10 秒）", t["備註"])
        self.assertEqual(m.trip_row(1, t)[m.TRIP_HEAD.index(m.GAP_COLS[0])], "")

    def test_crowd_mismatch_flagged(self):
        """離開士林國中的人數跟開進士林站的人數應該一樣（中間沒有站），不一樣就註記"""
        steps = [(b[0], b[1], b[2], b[3].replace(f"{m.MRT},20,1", f"{m.MRT},25,1")) for b in TRIP]
        events, crowds = run([snapshot(b) for b in steps])
        [t] = m.build_trips(events, crowds)
        self.assertIn("離開士林國中 20 人，到士林站時 25 人，對不起來", t["備註"])

    def test_crowd_at_windows(self):
        """進站後馬上回報的是進站人數；離站 20 秒後回報的是離站人數；只抓到進站也分得出來"""
        c = lambda hms, n: {"站牌ID": m.MRT, "回報時間": "2026-11-25 " + hms, "車上人數": str(n), "擁擠等級": "1"}
        t = lambda hms: datetime.strptime("2026-11-25 " + hms, "%Y-%m-%d %H:%M:%S")
        reports = [c("07:53:02", 20), c("07:54:20", 55)]
        self.assertEqual([x["車上人數"] for x in m.crowd_at(reports, m.MRT, t("07:53:00"), t("07:54:00"))], ["20", "55"])
        self.assertEqual([x["車上人數"] for x in m.crowd_at(reports, m.MRT, t("07:53:00"), None)], ["20", "55"])
        self.assertEqual(m.crowd_at(reports[:1], m.MRT, t("07:53:00"), None)[1], None)
        self.assertEqual(m.crowd_at([], m.MRT, t("07:53:00"), t("07:54:00")), (None, None))

    def test_missed_mrt_still_counted(self):
        """士林站漏抓但後面的站有紀錄：這班還是要算（不然間隔會算大），用士林國中離站時間代替並註記"""
        events, crowds = run([snapshot(b) for b in TRIP if b[2].split(",")[7] != m.MRT])
        [t] = m.build_trips(events, crowds)
        self.assertEqual(t["參考"], datetime(2026, 11, 25, 7, 51))
        self.assertIn("士林站沒抓到，排序和間隔用士林國中離站時間代替（早約 2 分）", t["備註"])
        self.assertEqual(m.trip_row(1, t)[m.TRIP_HEAD.index("士林站到站")], None)

    def test_arrival_count_filled_from_previous_stop(self):
        """進站那次沒回報（停站短常常這樣）：開進士林站的人數＝離開士林國中的人數，並註記"""
        steps = [(b[0], b[1], b[2], b[3].replace(f"{m.MRT},20,1,261125075302", f"{m.JHS},20,1,261125075120")) for b in TRIP]
        events, crowds = run([snapshot(b) for b in steps])
        [t] = m.build_trips(events, crowds)
        self.assertEqual(t["士林站到站人數"]["車上人數"], "20")
        self.assertIn("進站人數沒回報，用離開前一站的人數（中間沒人上下車）：到士林站時＝離開士林國中", t["備註"])

    def test_departure_count_tagged_as_next_stop(self):
        """離開士林站 20 秒後車已經到福林國小，人數標成福林國小：用那筆當離開士林站的人數（2026/11/24 EAA-078 實際發生）"""
        steps = [(b[0], b[1], b[2], b[3].replace(f"{m.MRT},55,3,261125075425", "171190,55,3,261125075505")) for b in TRIP]
        events, crowds = run([snapshot(b) for b in steps])
        [t] = m.build_trips(events, crowds)
        self.assertEqual(t["士林站人數"]["車上人數"], "55")
        self.assertIn("離站人數沒回報，用開進下一站時的人數（中間沒人上下車）：離開士林站＝到福林國小時", t["備註"])

    def test_already_past_mrt_when_monitoring_started(self):
        """監測開始時已經開過士林站的：不能拿後面站的時間代替，另外列出"""
        events, crowds = run([snapshot(b) for b in TRIP[12:14]])
        incomplete = []
        self.assertEqual(m.build_trips(events, crowds, incomplete), [])
        self.assertEqual(incomplete[0]["沒列原因"], "監測開始時已經開過士林站")

    def test_not_yet_at_mrt_listed_separately(self):
        """沒有士林站以後紀錄的（GPS 斷線、還在路上）不列進每班車，另外放進資料不完整"""
        events, crowds = run([snapshot(b) for b in TRIP[:9]])
        incomplete = []
        self.assertEqual(m.build_trips(events, crowds, incomplete), [])
        [t] = incomplete
        self.assertEqual(t["最後紀錄"], (datetime(2026, 11, 25, 7, 50), "士林國中"))
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "x.xlsx")
            m.write_excel(path, [], events, crowds, datetime(2026, 11, 25), incomplete)
            row = [c.value for c in load_workbook(path)["資料不完整"][3]]
            self.assertEqual(row[0], "EAA-001")
            self.assertEqual(row[3], "士林國中")

    def test_started_mid_route(self):
        """監測開始時車已經過天文館：發車留空並註記，後面照記"""
        events, crowds = run([snapshot(b) for b in TRIP[6:]])
        [t] = m.build_trips(events, crowds)
        self.assertIsNone(t["發車"])
        self.assertIn("沒抓到天文館發車（第一筆是士林區行政中心）", t["備註"])

    def test_headway_and_next_trip_of_same_bus(self):
        """兩台車的間隔；同一台車返程後再來算新的一趟"""
        shift = lambda b: (b[0], b[1], b[2].replace("2611250", "2611251").replace(",07", ",17"), b[3].replace("2611250", "2611251"))
        later = [shift(b) for b in TRIP]  # 同一台車傍晚再跑一趟：07:53 → 17:53 到士林站
        other = [(b[0], b[1], b[2].replace("261125075", "261125080"), b[3]) for b in trip_events("2", "EAA-002")
                 if m.MRT in b[2]]  # 第二台車 08:03 到士林站
        events, crowds = run([snapshot(b) for b in TRIP + other + later])
        trips = m.build_trips(events, crowds)
        self.assertEqual([t["車牌"] for t in trips], ["EAA-001", "EAA-002", "EAA-001"])
        self.assertEqual([t["間隔"] for t in trips], ["", 10.0, 590.0])

    def test_return_direction_ignored(self):
        """回程經過士林站（站牌代號不同、方向 1）不算"""
        events, crowds = run([snapshot(("3", "EAA-3", a2("3", "1", "171170", "1", "261125080000"), ""))])
        self.assertEqual(m.build_trips(events, crowds), [])


class ExcelTest(unittest.TestCase):
    def test_excel_columns(self):
        events, crowds = run([snapshot(b) for b in TRIP])
        trips = m.build_trips(events, crowds)
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "x.xlsx")
            self.assertTrue(m.write_excel(path, trips, events, crowds, datetime(2026, 11, 25)))
            wb = load_workbook(path)
            ws = wb["每班車"]
            got = dict(zip(m.TRIP_HEAD, [c.value for c in ws[2]]))
            self.assertEqual(got["天文館發車"].strftime("%H:%M:%S"), "07:40:00")
            self.assertEqual([got[c] for c in m.GAP_COLS], [0.5, 2.5, 3.0, 4.0, 3.0, 12.0])
            self.assertEqual(got["天文館→東吳總計(分)"], 25.0)
            self.assertEqual([got[l + k] for l in ("到士林國中時", "離開士林國中", "到士林站時", "離開士林站") for k in ("人數", "擁擠")],
                             [18, "舒適", 20, "舒適", 20, "舒適", 55, "擁擠"])
            self.assertEqual(got["士林站淨上車(人)"], 35)
            col = {n: i for i, n in enumerate(m.TRIP_HEAD)}
            color = lambda name: ws[2][col[name]].fill.fgColor.rgb[-6:]
            self.assertEqual((color("離開士林國中人數"), color("離開士林站擁擠")), ("C6EFCE", "FFC7CE"), "綠舒適、紅擁擠")
            slot = [c.value for c in wb["每15分鐘"][3]]
            self.assertEqual(slot[:2] + slot[-2:], ["07:45–08:00", 1, 10.0, 12.0])


if __name__ == "__main__":
    unittest.main()
