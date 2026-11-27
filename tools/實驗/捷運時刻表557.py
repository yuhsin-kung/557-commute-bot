# 執行（在專案根目錄）：uv run --with openpyxl --with scikit-learn python tools/實驗/捷運時刻表557.py
"""捷運時刻表能不能解釋「這班在士林站上了幾人」：只用前一班不用排、這班也不用排的相鄰兩班（上車數是真的，不是下限）"""
import importlib.util, csv, numpy as np
from datetime import datetime, timedelta
spec=importlib.util.spec_from_file_location('Q','tools/排隊模擬557.py');Q=importlib.util.module_from_spec(spec);spec.loader.exec_module(Q)
L,p=Q.L,Q.p
tt={"往北投淡水":[], "往大安廣慈":[]}
with open("data/捷運士林站平日時刻表.csv",encoding="utf-8-sig") as f:
    next(f)
    for r in csv.DictReader(f):
        h,m=r["離站時間"].split(":"); tt[r["方向"]].append(int(h)*60+int(m))
pairs=[]
for d in L.DAYS:
    rows=Q.bus_rows(L.load_trips(d),p.load_day(d))
    for a,b in zip(rows,rows[1:]):
        dt=(b["a"]-a["a"]).total_seconds()/60
        if a["full"] is not False or b["full"] is not False or b["jhs"] is None or b["mrt"] is None or not 0<dt<=30: continue
        pairs.append(dict(day=d,t0=L.tod(a["a"]),t1=L.tod(b["a"]),dt=dt,y=max(0,b["mrt"]-b["jhs"])))
print("可用的相鄰兩班",len(pairs),"（早上 07:00–10:30：",sum(7*60<=x["t1"]<=630 for x in pairs),"）")
def count(times,lo,hi): return sum(lo<t<=hi for t in times)
def feats(x,w):
    n=count(tt["往北投淡水"],x["t0"]-w,x["t1"]-w); s=count(tt["往大安廣慈"],x["t0"]-w,x["t1"]-w)
    return n,s
def lodo(w, keep):
    errA,errB,errC=[],[],[]
    for test in L.DAYS:
        tr=[x for x in pairs if x["day"]!=test and keep(x)]; te=[x for x in pairs if x["day"]==test and keep(x)]
        if len(tr)<10 or not te: continue
        # A：每分鐘來幾人 × 間隔（每小時一格）
        lam={}
        for x in tr: lam.setdefault(int(x["t1"]//60),[0,0]); lam[int(x["t1"]//60)][0]+=x["y"]; lam[int(x["t1"]//60)][1]+=x["dt"]
        allr=sum(x["y"] for x in tr)/sum(x["dt"] for x in tr)
        A=lambda x: (lam[int(x["t1"]//60)][0]/lam[int(x["t1"]//60)][1] if int(x["t1"]//60) in lam else allr)*x["dt"]
        # B：每班捷運帶來幾人（兩個方向各一個係數，每小時一格不分）
        X=np.array([feats(x,w) for x in tr],float); y=np.array([x["y"] for x in tr])
        beta=np.linalg.lstsq(X,y,rcond=None)[0]
        # C：A 再加「捷運比平常多幾班」的修正
        E=np.array([[x["dt"]*len([t for t in tt[k] if int(x["t1"]//60)*60<=t<int(x["t1"]//60)*60+60])/60 for k in tt] for x in tr])
        res=y-np.array([A(x) for x in tr]); g=np.linalg.lstsq(X-E,res,rcond=None)[0]
        for x in te:
            f=np.array(feats(x,w),float); e=np.array([x["dt"]*len([t for t in tt[k] if int(x["t1"]//60)*60<=t<int(x["t1"]//60)*60+60])/60 for k in tt])
            errA.append(abs(A(x)-x["y"])); errB.append(abs(f@beta-x["y"])); errC.append(abs(A(x)+(f-e)@g-x["y"]))
    return np.mean(errA),np.mean(errB),np.mean(errC),len(errA)
for name,keep in (("全天",lambda x:True),("早上 07:00–10:30",lambda x:420<=x["t1"]<=630)):
    print(f"\n{name}：輪流考試，預測這班在士林站上幾人，平均差幾人")
    for w in range(0,8):
        a,b,c,n=lodo(w,keep)
        print(f"  走到站牌 {w} 分：只看間隔 {a:.1f}｜只看捷運班數 {b:.1f}｜間隔＋捷運修正 {c:.1f}（{n} 筆）")
# 例子
print("\n早上的例子（走 3 分鐘）：")
for x in pairs:
    if 420<=x["t1"]<=630:
        n,s=feats(x,3)
        print(f"  {x['day'][5:]} {int(x['t0']//60):02d}:{int(x['t0']%60):02d}→{int(x['t1']//60):02d}:{int(x['t1']%60):02d} 間隔{x['dt']:4.1f} 分 上車 {x['y']:2d} 人｜往北投捷運 {n} 班、往大安 {s} 班")
