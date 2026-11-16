from pathlib import Path
import json, zipfile, math
import xml.etree.ElementTree as ET
from pypdf import PdfReader

root=Path(r'C:/Users/zhary/OneDrive/Desktop/Qadam Delivery')
xlsx=root/'outputs/qadam-task5-20261111/Qadam_Task5_Unit_Economics_EN.xlsx'
pdf=root/'output/pdf/Qadam_Delivery_Task5_Business_Model_EN.pdf'
ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main','c':'http://schemas.openxmlformats.org/drawingml/2006/chart','a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
with zipfile.ZipFile(xlsx) as z:
    workbook=ET.fromstring(z.read('xl/workbook.xml'))
    sheet_names=[s.attrib['name'] for s in workbook.findall('s:sheets/s:sheet',ns)]
    assert sheet_names==['Overview','Inputs','Pricing','Unit Economics','Cohort']
    errors=[]
    for member in z.namelist():
        if member.startswith('xl/worksheets/sheet') and member.endswith('.xml'):
            xml=ET.fromstring(z.read(member))
            errors += [(member,c.attrib['r'],c.findtext('s:v',namespaces=ns)) for c in xml.findall('.//s:c',ns) if c.attrib.get('t')=='e']
    assert not errors,errors
    econ=ET.fromstring(z.read('xl/worksheets/sheet4.xml'))
    cells={c.attrib['r']:c for c in econ.findall('.//s:c',ns)}
    expected={'D12':4800,'D24':1696,'D25':3104,'D35':480000,'D36':24000,'D42':4.311111111111111,'D43':24000/3104,'D44':3104*(1-.97**36)/.03,'D53':9}
    for address,value in expected.items():
        cell=cells[address]
        assert cell.find('s:f',ns) is not None,(address,'formula missing')
        assert math.isclose(float(cell.findtext('s:v',namespaces=ns)),value,rel_tol=1e-8),(address,value,cell.findtext('s:v',namespaces=ns))
    inputs=ET.fromstring(z.read('xl/worksheets/sheet2.xml'))
    inp={c.attrib['r']:c for c in inputs.findall('.//s:c',ns)}
    assert inp['D5'].findtext('s:v',namespaces=ns)=='2','Base scenario must be selected on delivery'
    charts=[n for n in z.namelist() if '/charts/chart' in n and n.endswith('.xml')]
    assert len(charts)==1
    chart=ET.fromstring(z.read(charts[0]))
    bindings=[x.text for x in chart.findall('.//c:f',ns)]
    assert any('K' in (f or '') and 'Cohort' in (f or '') for f in bindings),bindings
    rgb=[x.attrib.get('val') for x in chart.findall('.//a:srgbClr',ns)]
    assert '28624D' in rgb and '87938F' in rgb,rgb
    assert not any(n.startswith('xl/externalLinks/') for n in z.namelist())

r=PdfReader(pdf)
assert len(r.pages)==10
links=[]
for pg in r.pages:
    for ref in pg.get('/Annots',[]):
        obj=ref.get_object()
        if obj.get('/A') and obj['/A'].get('/URI'): links.append(obj['/A']['/URI'])
assert 'https://www.bvp.com/atlas/scaling-to-100-million' in links
assert 'https://a16z.com/13-metrics-for-marketplace-companies/' in links
print(json.dumps({'pdf_pages':len(r.pages),'workbook_sheets':sheet_names,'saved_formula_errors':len(errors),'headline_cached_results':'match independent calculations','editable_chart':'bindings and exported colors verified','pdf_bytes':pdf.stat().st_size,'xlsx_bytes':xlsx.stat().st_size},indent=2))
