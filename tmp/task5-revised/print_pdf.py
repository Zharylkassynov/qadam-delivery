from pathlib import Path
import zipfile, io, posixpath
from lxml import etree as E
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor
from reportlab.lib.utils import ImageReader
from pypdf import PdfReader

ROOT=Path(r'C:/Users/zhary/OneDrive/Desktop/Qadam Delivery')
source=ROOT/'tmp/task5-revised/candidate.pptx'
target=ROOT/'deliverables/Qadam-Task5-Revised/Qadam_Task5_Presentation_EN.pdf'
N={'p':'http://schemas.openxmlformats.org/presentationml/2006/main','a':'http://schemas.openxmlformats.org/drawingml/2006/main','r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
for name,file in [('Arial','arial.ttf'),('Arial-Bold','arialbd.ttf')]:
 pdfmetrics.registerFont(TTFont(name,str(Path('C:/Windows/Fonts')/file)))
def col(el,default='153346'):
 if el is None:return HexColor('#'+default)
 rgb=el.find('a:solidFill/a:srgbClr',N)
 return HexColor('#'+(rgb.get('val') if rgb is not None else default))
def pos(el):
 off=el.find('a:off',N);ext=el.find('a:ext',N)
 return [int(off.get(k))/12700 for k in ['x','y']]+[int(ext.get(k))/12700 for k in ['cx','cy']]
def contents(body):
 result=[]
 for par in body.findall('a:p',N):
  line=''
  for child in par:
   if child.tag.endswith('}br'):line+='\n'
   elif child.tag.endswith('}r') or child.tag.endswith('}fld'):line+=''.join(child.itertext())
  result.append(line)
 return '\n'.join(result)
def text(body,x,y,w,h,properties=None):
 if body is None:return
 rp=body.find('.//a:rPr',N)
 if rp is None:rp=body.find('.//a:defRPr',N)
 size=float(rp.get('sz','1800'))/100 if rp is not None else 18
 font='Arial-Bold' if rp is not None and rp.get('b')=='1' else 'Arial'
 color=col(rp)
 bp=body.find('a:bodyPr',N)
 l=r=t=b=0
 if bp is not None:
  l=int(bp.get('lIns','0'))/12700;r=int(bp.get('rIns','0'))/12700;t=int(bp.get('tIns','0'))/12700;b=int(bp.get('bIns','0'))/12700
 anchor='t'
 if properties is not None:
  l=int(properties.get('marL',str(int(l*12700))))/12700;r=int(properties.get('marR',str(int(r*12700))))/12700
  t=int(properties.get('marT',str(int(t*12700))))/12700;b=int(properties.get('marB',str(int(b*12700))))/12700
  anchor=properties.get('anchor','t')
 lines=[]
 for para in contents(body).split('\n'):
  if not para:lines.append('');continue
  current=''
  for word in para.split(' '):
   test=(current+' '+word).strip()
   if current and pdfmetrics.stringWidth(test,font,size)>w-l-r:
    lines.append(current);current=word
   else:current=test
  lines.append(current)
 leading=size*1.16
 yy=y+t
 if anchor=='ctr':yy += max(0,(h-t-b-len(lines)*leading)/2)
 c.setFillColor(color);c.setFont(font,size)
 for line in lines:
  c.drawString(x+l,540-yy-size*.94,line);yy+=leading

with zipfile.ZipFile(source) as z:
 c=canvas.Canvas(str(target),pagesize=(960,540),pageCompression=1)
 c.setTitle('Qadam Delivery - Task 5 Business Model and Unit Economics')
 c.setAuthor('Qadam Delivery Team')
 for idx in range(1,13):
  root=E.fromstring(z.read(f'ppt/slides/slide{idx}.xml'))
  relxml=E.fromstring(z.read(f'ppt/slides/_rels/slide{idx}.xml.rels'))
  rels={r.get('Id'):r.get('Target') for r in relxml}
  tree=root.find('p:cSld/p:spTree',N)
  for node in tree:
   tag=E.QName(node).localname
   if tag=='sp':
    xf=node.find('p:spPr/a:xfrm',N)
    if xf is not None:text(node.find('p:txBody',N),*pos(xf))
   elif tag=='pic':
    x,y,w,h=pos(node.find('p:spPr/a:xfrm',N));blip=node.find('p:blipFill/a:blip',N)
    dest=posixpath.normpath(posixpath.join('ppt/slides',rels[blip.get('{'+N['r']+'}embed')])).lstrip('/')
    c.drawImage(ImageReader(io.BytesIO(z.read(dest))),x,540-y-h,w,h)
   elif tag=='graphicFrame':
    xf=node.find('p:xfrm',N);x,y,w,h=pos(xf)
    table=node.find('.//a:tbl',N)
    if table is None:continue
    widths=[int(g.get('w'))/12700 for g in table.findall('a:tblGrid/a:gridCol',N)]
    cy=y
    for row in table.findall('a:tr',N):
     rh=int(row.get('h'))/12700;cx=x
     for cell,cw in zip(row.findall('a:tc',N),widths):
      props=cell.find('a:tcPr',N)
      c.setFillColor(col(props,'FFFFFF'));c.setStrokeColor(HexColor('#D5DEEF'));c.setLineWidth(.45)
      c.rect(cx,540-cy-rh,cw,rh,fill=1,stroke=1)
      text(cell.find('a:txBody',N),cx,cy,cw,rh,props);cx+=cw
     cy+=rh
  if idx==12:c.linkURL('https://www.bvp.com/atlas/scaling-to-100-million',(48,15,760,40),relative=0,thickness=0)
  c.showPage()
 c.save()
reader=PdfReader(target)
assert len(reader.pages)==12
text_all='\n'.join(p.extract_text() for p in reader.pages)
for value in ['Task 5','3.33','2.81','2,732','8,300','60,000','300','30']:
 assert value in text_all,value
(ROOT/'tmp/task5-revised/final_pdf_text.txt').write_text(text_all,encoding='utf-8')
print('Created searchable 12-page PDF:',target)
