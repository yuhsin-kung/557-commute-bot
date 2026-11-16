"""把 report.html 轉成 PDF：Edge 列印 → 填目錄頁碼 → 再列印 → 加頁碼。用法：python build.py"""
import subprocess, re, sys, pathlib, pymupdf
HERE = pathlib.Path(__file__).resolve().parent
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
SRC, TMP_HTML = HERE/"report.html", HERE/"_build.html"
RAW, OUT = HERE/"_raw.pdf", HERE/"557通勤平台_期中報告.pdf"
FRONT = 2  # 封面＋目錄不編頁碼
HEADS = {"s1":"壹、專案背景與問題定義","s2":"貳、使用者需求與現況分析","s3":"參、創新解決方案設計",
         "s4":"肆、技術應用與可行性分析","s5":"伍、專案執行進度與初步成果","s6":"陸、後續工作規劃與團隊分工",
         "s7":"柒、結語","ref":"參考文獻","ap1":"附錄一","ap2":"附錄二"}

def render(html):
    subprocess.run([EDGE,"--headless","--disable-gpu","--no-pdf-header-footer",
                    f"--print-to-pdf={RAW}", html.as_uri()], check=True, capture_output=True)

def find_pages():
    d = pymupdf.open(RAW); res = {}
    for k, h in HEADS.items():
        for i in range(FRONT, len(d)):
            if h in d[i].get_text():
                res[k] = i - FRONT + 1; break
    return res, len(d)

html = SRC.read_text(encoding="utf-8")
TMP_HTML.write_text(html, encoding="utf-8"); render(TMP_HTML)
pages, n = find_pages()
for k, p in pages.items():
    html = re.sub(rf'(data-for="{k}">)[^<]*', rf'\g<1>{p}', html)
TMP_HTML.write_text(html, encoding="utf-8"); render(TMP_HTML)
pages, n = find_pages()
d = pymupdf.open(RAW)
for i in range(FRONT, len(d)):
    pg = d[i]; w, h = pg.rect.width, pg.rect.height
    pg.insert_textbox(pymupdf.Rect(0, h-45, w, h-25), str(i-FRONT+1), fontsize=10, fontname="tiro", align=1)
d.set_metadata({"title":"557通勤平台_期中報告","author":"龔俞心、簡晨芸、林紹軒","subject":"智慧創新整合實務 學生專案計畫期中報告"})
d.save(OUT); d.close()
RAW.unlink(); TMP_HTML.unlink()
body_end = pages.get("ref", n-FRONT+1) - 1
print("sections:", pages, "total:", n, "body:", body_end)
