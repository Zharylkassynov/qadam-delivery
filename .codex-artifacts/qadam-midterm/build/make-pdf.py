from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from pypdf import PdfReader

root=Path('C:/Users/zhary/OneDrive/Desktop/Qadam Delivery')
build=root/'.codex-artifacts/qadam-midterm/build'
out=root/'deliverables/Qadam-Midterm/Qadam_Delivery_Midterm.pdf'
c=canvas.Canvas(str(out),pagesize=(960,540))
c.setTitle('Qadam Delivery — Midterm Defense')
c.setAuthor('Qadam Delivery')
for i in range(1,11):
    c.drawImage(ImageReader(str(build/f'slide-{i:02}.png')),0,0,width=960,height=540)
    c.showPage()
c.save()
r=PdfReader(str(out))
assert len(r.pages)==10
assert all(float(page.mediabox.width)==960 and float(page.mediabox.height)==540 for page in r.pages)
print(f'PDF: {len(r.pages)} pages, {out.stat().st_size} bytes')
