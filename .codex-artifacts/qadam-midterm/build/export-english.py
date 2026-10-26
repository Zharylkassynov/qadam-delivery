from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from pypdf import PdfReader
root=Path('C:/Users/zhary/OneDrive/Desktop/Qadam Delivery')
build=root/'.codex-artifacts/qadam-midterm/build-en'
out=root/'deliverables/Qadam-Midterm-English/Qadam_Delivery_Midterm_EN_Final.pdf'
c=canvas.Canvas(str(out),pagesize=(960,540))
c.setTitle('Qadam Delivery - Midterm Defense (English)')
c.setAuthor('Qadam Delivery')
for i in range(1,11):
    c.drawImage(ImageReader(str(build/f'slide-{i:02}.png')),0,0,width=960,height=540)
    c.showPage()
c.save()
assert len(PdfReader(str(out)).pages)==10
print('English PDF: 10 pages')
