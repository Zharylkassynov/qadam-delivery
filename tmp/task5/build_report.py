from pathlib import Path
import json, math
from xml.sax.saxutils import escape
from reportlab.pdfgen import canvas
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from pypdf import PdfReader

ROOT = Path(r'C:/Users/zhary/OneDrive/Desktop/Qadam Delivery')
WORK = ROOT/'tmp/task5'
OUT = ROOT/'output/pdf/Qadam_Delivery_Task5_Business_Model_EN.pdf'
data = json.loads((WORK/'model_results.json').read_text(encoding='utf-8'))
b = data['base']
for name, fn in [('Arial','arial.ttf'), ('Arial-Bold','arialbd.ttf'), ('Arial-Italic','ariali.ttf'), ('Arial-BoldItalic','arialbi.ttf')]:
    pdfmetrics.registerFont(TTFont(name, str(Path('C:/Windows/Fonts')/fn)))
pdfmetrics.registerFontFamily('Arial', normal='Arial', bold='Arial-Bold', italic='Arial-Italic', boldItalic='Arial-BoldItalic')

INK = colors.HexColor('#172C35')
GREEN = colors.HexColor('#28624D')
PALE = colors.HexColor('#EAF2ED')
MUTED = colors.HexColor('#53666D')
LINE = colors.HexColor('#D8E2DC')
AMBER = colors.HexColor('#FFF2D9')
W, H = A4
CW = W - 84
styles = {
  'body': ParagraphStyle('Body',fontName='Arial',fontSize=10,leading=14,textColor=INK,spaceAfter=8),
  'small': ParagraphStyle('Small',fontName='Arial',fontSize=8.7,leading=12,textColor=MUTED,spaceAfter=6),
  'h1': ParagraphStyle('H1',fontName='Arial-Bold',fontSize=23,leading=27,textColor=INK,spaceAfter=12),
  'h2': ParagraphStyle('H2',fontName='Arial-Bold',fontSize=12,leading=16,textColor=GREEN,spaceBefore=8,spaceAfter=7),
  'cover': ParagraphStyle('Cover',fontName='Arial-Bold',fontSize=35,leading=39,textColor=INK,spaceAfter=14),
  'eyebrow': ParagraphStyle('Eyebrow',fontName='Arial-Bold',fontSize=10,leading=14,textColor=GREEN,spaceAfter=10),
  'cell': ParagraphStyle('Cell',fontName='Arial',fontSize=9.1,leading=12,textColor=INK,spaceAfter=0),
  'th': ParagraphStyle('TH',fontName='Arial-Bold',fontSize=9.1,leading=12,textColor=colors.white,spaceAfter=0),
  'formula': ParagraphStyle('Formula',fontName='Arial',fontSize=9.6,leading=14,textColor=INK,spaceAfter=9,leftIndent=10),
}
story=[]
def p(txt, sty='body'):
    story.append(Paragraph(txt, styles[sty]))
def h(txt): p(txt,'h2')
def page(n,title,sub=None):
    if story: story.append(PageBreak())
    p(f'{n:02d} / BUSINESS MODEL', 'eyebrow')
    p(title,'h1')
    if sub: p(sub,'small')
def table(headers, rows, widths=None, small=False):
    if widths is None: widths=[CW/len(headers)]*len(headers)
    body=[[Paragraph(str(c), styles['th']) for c in headers]]
    body += [[Paragraph(str(c), styles['cell']) for c in row] for row in rows]
    t=Table(body, colWidths=widths, hAlign='LEFT', repeatRows=1)
    t.setStyle(TableStyle([
      ('BACKGROUND',(0,0),(-1,0),INK),('VALIGN',(0,0),(-1,-1),'TOP'),
      ('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),
      ('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8),
      ('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,colors.HexColor('#F5F8F5')]),
      ('LINEBELOW',(0,0),(-1,0),.6,INK),('LINEBELOW',(0,-1),(-1,-1),.6,LINE),
    ]))
    story.append(t);story.append(Spacer(1,9))
def note(title, txt, bg=PALE):
    t=Table([[Paragraph(f'<b>{title}</b><br/>{txt}',styles['body'])]],colWidths=[CW])
    t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),bg),('LEFTPADDING',(0,0),(-1,-1),12),('RIGHTPADDING',(0,0),(-1,-1),12),('TOPPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),4)]))
    story.append(t);story.append(Spacer(1,9))
def money(v): return f'{v:,.0f}'

# Page 1
p('NARXOZ UNIVERSITY', 'eyebrow')
p('School of Digital Technologies<br/>Technological Entrepreneurship', 'small')
story.append(Spacer(1,22))
p('Qadam<br/>Delivery', 'cover')
p('Task 5: Business Model and<br/>Financial Unit Economics', 'h1')
p('Team assignment report<br/>Prepared 11 November 2026<br/>Team: Qadam Delivery', 'body')
story.append(Spacer(1,14))
table(['PRIMARY MODEL','VALUE METRIC','BEACHHEAD'],[[
    'Transaction / usage-based','One completed delivery coordinated','Small Almaty flower, gift and social-commerce shops'
]], [CW*.30,CW*.30,CW*.40])
table(['BASE LTV / CAC','SIMPLE CAC PAYBACK','36-MONTH LTV / CAC'],[[
    f'<b>{b["ratio"]:.2f}x</b>',f'<b>{b["payback"]:.2f} months</b>',f'<b>{b["ratio36"]:.2f}x</b>'
]])
h('Commercial proposal')
p('Charge the shop a fixed platform fee after a completed delivery: <b>KZT 120 Starter, KZT 90 Pro and from KZT 60 Enterprise</b>. The courier fare remains separate and is paid in full to the courier. Pro and Enterprise have credited monthly usage commitments.')
note('Decision', 'The base assumptions meet the reference hurdles of uncapped LTV/CAC at least 3x and SMB payback below 12 months. A 36-month capped LTV falls below 3x. Commercial viability remains a hypothesis until paying cohorts validate acquisition, retention and service costs.')
p('<b>Evidence boundary.</b> The earlier Task 4 report modeled 600 seconds versus 90 seconds, or 6.67x active-time efficiency. No measured 10x result, shop willingness-to-pay dataset or paid retention cohort was supplied. This report labels estimates explicitly. The current pilot still uses 0% Qadam commission. [T4, P1]', 'small')

# Page 2
page(2,'Choose the monetization archetype')
h('Beachhead and transaction roles')
p('The first paying customer is the owner or administrator of a one-location flower, gift or small social-commerce shop in Almaty. The base customer makes 40 repeat deliveries a month, carried forward as an assumption from Task 4. Private senders can use Qadam but are excluded from this business-customer acquisition model. [T4]')
p('<b>Demand side:</b> shops needing local parcel delivery. <b>Supply side:</b> couriers accepting and completing orders. The recipient receives the parcel and status information. Qadam coordinates order creation, acceptance, handoff, status history and last-known location.')
table(['Archetype','Assessment and selection'],[
 ['Subscription / SaaS','Predictable billing, but a mandatory fee before delivery demand is proven raises adoption friction. Stable usage and low churn have not been demonstrated. Not the primary model.'],
 ['Marketplace percentage rake','Would scale with courier fare, including distance and traffic that do not necessarily increase coordination value. A deduction from courier earnings would change the 0% pilot proposition. Rejected for the first commercial test.'],
 ['Transaction / usage-based','<b>Selected.</b> A fixed customer-side fee per completed delivery aligns revenue with useful outcomes, is easy to audit and lets small shops start without a commitment.'],
 ['Freemium / hybrid','An indefinite free tier would incur support costs before any demonstrated 5-10% premium conversion. Pro and Enterprise use minimum usage commitments, fully credited to delivery fees, rather than an extra subscription.']
],[CW*.27,CW*.73])
h('Transaction and money flow')
p('1. The shop creates an order and sees courier fare and platform fee separately.<br/>2. A courier accepts, collects and completes the delivery with a completion record.<br/>3. The agreed courier fare is paid directly to the courier. Qadam invoices the shop for completed-delivery fees monthly. No platform fee is charged for cancellations or unmatched orders.')
h('Start with local liquidity')
p('A proposed test cluster is <b>10 shops in one service zone</b>: 10 x 40 / 26 = <b>15.4 deliveries per dispatch day</b>. At a hypothetical peak of five requests/hour, a 45-minute full courier cycle and 70% planned utilization, required online supply is ceil(5 x 45 / 60 / 0.70) = <b>6 couriers</b>, plus two roster backups. These are capacity assumptions, not registered or committed supply.')
p('Commercial test gates: at least 90% of valid requests accepted within 10 minutes and at least 95% of accepted orders completed. Recheck them by zone and time window before expanding. Marketplace match rate and time to match are distinct from courier utilization. [A1]', 'small')

# Page 3
page(3,'Translate time into economic value', 'The comparison covers active shop coordination, not travel speed or courier earnings.')
table(['Activity','As-Is','Qadam target'],[
 ['Prepare repeat-order details','180 seconds','45 seconds'],
 ['Confirm acceptance / handoff','120 seconds','15 seconds'],
 ['Find a delivery update','180 seconds','20 seconds'],
 ['Locate the completion record','120 seconds','10 seconds'],
 ['<b>Total active staff time</b>','<b>600 seconds</b>','<b>90 seconds</b>'],
],[CW*.54,CW*.23,CW*.23])
p('Every time above is an estimate from Task 4, not a recorded customer result. Identical parcel details and scripted events must be used in both workflows. Count corrections, negotiation and follow-up in the workflow that causes them. Exclude passive waiting and travel from active-time comparisons. [T4]')
h('Base As-Is versus To-Be math')
p('Efficiency = 600 / 90 = <b>6.67x</b>. Active-time reduction = (600 - 90) / 600 = <b>85%</b>.', 'formula')
p('At the assumed KZT 1,500/hour:<br/>As-Is labor value = 600 / 3,600 x 1,500 = <b>KZT 250/order</b>.<br/>To-Be labor value = 90 / 3,600 x 1,500 = <b>KZT 37.50/order</b>.<br/>Released capacity = 250 - 37.50 = <b>KZT 212.50/order</b>.', 'formula')
p('At 40 deliveries/month, released time is <b>5.67 hours</b>, valued at <b>KZT 8,500/month</b>. At a KZT 120 platform fee, the shop pays KZT 4,800 and retains <b>KZT 3,700/month</b> of modeled labor capacity value. The value-to-fee ratio is 8,500 / 4,800 = <b>1.77x</b>.')
note('The assignment\'s 10x requirement remains unvalidated', 'A genuine 10x active-time result would require 600 / 60 = 10x. The 60-second workflow is an engineering target. At that target, released labor value would be KZT 225/order. The financial base case uses the earlier 90-second assumption, so the 10x target does not inflate LTV.', AMBER)
h('Keep the economic claim precise')
p('Including an illustrative, unchanged KZT 1,500 courier fare, full cost per order is KZT 1,750 As-Is and KZT 1,657.50 To-Be including the fee. That is about <b>5.3% total-cost reduction</b>, not 10x cheaper delivery. Released staff capacity becomes cash savings only if the shop actually reduces paid labor or uses the time to generate additional contribution.')

# Page 4
page(4,'Price against value and switching costs')
h('Why cost plus 20% fails')
p('<b>It ignores willingness to pay.</b> A shop evaluates less administrative work, reliable coordination and alternatives. Server costs do not reveal what that shop will pay. Under the base cost assumptions, non-payment service cost is KZT 25/order plus KZT 600/40 in account costs, or KZT 40/order. Adding 20% gives KZT 48 before payment costs. This does not test whether the customer would accept the proposed KZT 120, or reject any fee at all.')
p('<b>It ignores switching costs.</b> Moving from WhatsApp and a known courier requires setup, training and trust. Even a price below estimated savings may fail when a shop has an efficient existing workflow or unreliable courier supply. A 30-minute setup at KZT 1,500/hour is an assumed <b>KZT 750 one-time cost</b>. It belongs in the customer\'s adoption decision, separately from Qadam\'s onboarding expense in CAC.')
p('<b>It can leave value uncaptured or overprice a weak product.</b> A percentage markup treats low technical cost as low value and may push prices up when the platform is inefficient. A 20% markup is only a 16.7% margin before payment costs. Qadam should use costs to test feasibility, then test the customer\'s economic benefit and actual WTP to set the fee.')
h('One primary value metric')
note('A completed delivery coordinated for a paying shop', 'A billable event is an order with a retained completed-delivery record. Each completed order is charged once. Cancellation, duplicate retries and unmatched requests do not create platform-fee events. Fees for failed attempts are not added silently.')
p('This unit scales with the shop\'s number of fulfilled dispatches. Each additional order creates a coordination task and, under the time hypothesis, another KZT 212.50 of released labor capacity. Seats penalize a shop for adding staff. Distance and parcel value can increase courier compensation without increasing coordination value, so neither is the primary platform pricing unit.')
h('Starter value capture and adoption hurdle')
p('KZT 120 captures <b>56.5%</b> of the modeled KZT 212.50/order benefit, leaving <b>KZT 92.50/order</b> with the shop. At 40 orders, first-month net capacity value after setup is 8,500 - 4,800 - 750 = <b>KZT 2,950</b>. Recovering the setup effort takes 750 / 92.50 = <b>8.1 completed orders</b> under the assumptions.')
p('The retained value is a pricing hypothesis, not proof of WTP. Validate paid acceptance and repeat use at the proposed price. If realized savings are lower, revise the price, scope or segment rather than assuming interviews guarantee purchase.')

# Page 5
page(5,'A three-tier pricing architecture', 'Proposed future commercial terms. These tariffs are not enabled in the current pilot.')
table(['','Starter','Pro','Enterprise'],[
 ['Primary buyer','Small repeat sender','Growing / mid-market shop operation','Larger or multi-location operation'],
 ['Platform fee','<b>KZT 120 / completed order</b>','<b>KZT 90 / completed order</b>','<b>From KZT 60 / completed order</b>'],
 ['Monthly commitment','None','100 order equivalents<br/><b>KZT 9,000 minimum</b>','500 order equivalents<br/><b>KZT 30,000 minimum</b>'],
 ['Core utility','Order coordination, status history, saved pickup and repeat orders','Starter plus proposed batch entry and CSV / reconciliation reports','Pro plus scoped custom API integrations and contracting'],
 ['Service / security','Standard support and existing access controls','Proposed business-hours priority support and team workflow','Negotiated SLA, dedicated contact, advanced roles and audit exports'],
 ['Value captured','120 / 212.50 = <b>56.5%</b>','90 / 212.50 = <b>42.4%</b>','60 / 212.50 = <b>28.2%</b>'],
],[CW*.20,CW*.265,CW*.265,CW*.27])
h('Transparent billing rules')
p('Monthly platform bill = <b>fee x max(actual completed orders, committed order equivalents)</b>. The commitment is fully credited against usage. A Pro customer with 120 completed orders pays 120 x 90 = KZT 10,800, not KZT 19,800. Starter with 40 orders pays KZT 4,800.')
p('At the minimum commitments, modeled monthly labor benefit is KZT 21,250 for Pro and KZT 106,250 for Enterprise. The respective benefits retained after platform fees are KZT 12,250 and KZT 76,250. A shop should commit only when its expected usage makes the plan economical. Unused commitments expire monthly and must be explained before purchase.')
h('Scope follows delivery capability')
p('Existing core coordination is documented in the project. Batch tools, commercial reporting, custom integrations, dedicated SLAs and enhanced enterprise controls are <b>proposed capabilities</b>. Enterprise KZT 60 is a planning floor for an agreed scope. Custom development and support must be costed before a quote is accepted. This report does not estimate enterprise LTV from Starter economics.')
p('Any Enterprise SLA should specify measurable service availability and support-response obligations after testing. It must not promise continuous courier GPS when the Mini App is closed or guaranteed delivery timing without validated supply. The courier fare remains separate in every tier. Prices are modeled before applicable taxes; no tax registration or tax rate is assumed.', 'small')

# Page 6
page(6,'Build a fully loaded cost model', 'Unit of acquisition: one new paying business account. All amounts are KZT.')
table(['Monthly acquisition component','Calculation','Cost'],[
 ['Digital advertising','Budget assumption','80,000'],
 ['Channel partner commissions','Budget assumption','40,000'],
 ['Sales salary / founder replacement labor','0.5 FTE x 480,000','240,000'],
 ['Employer payroll allowance','20% x 240,000','48,000'],
 ['Initial onboarding','Full monthly allocated budget','40,000'],
 ['Courier acquisition','Supply-side cohort allocation','32,000'],
 ['<b>Total acquisition cost pool</b>','<b>Sum of all components</b>','<b>480,000</b>'],
],[CW*.49,CW*.32,CW*.19])
p('<b>Blended CAC = 480,000 / 20 new paying stores = KZT 24,000.</b> The denominator excludes free registrations, couriers and recipients. The acquisition funnel hypothesis is 200 leads, 80 qualified shops, 40 activated trials and 20 paying shops. Spend and customer counts must be matched to the same acquisition cycle. Sales labor is costed even if founders initially defer cash pay.')
table(['Direct monthly service cost / store','Calculation','Cost'],[
 ['Maps and notifications','40 x 5','200'],
 ['Order-level support','40 x 12','480'],
 ['Service-credit / failed-attempt reserve','40 x 8','320'],
 ['Payment processing on platform fees','2% x 4,800','96'],
 ['Ongoing account support','Per active store','500'],
 ['Account infrastructure','Per active store','100'],
 ['<b>Total direct COGS</b>','<b>Sum of components</b>','<b>1,696</b>'],
],[CW*.49,CW*.32,CW*.19])
p('All cost and conversion figures above are planning assumptions, not supplier quotes or recorded expense data. The 2% processing allowance applies only to Qadam\'s fee. Courier fares are paid directly, so their payment-processing cost is not included. Any later decision to collect the entire fare requires a revised cost model.')
p('Courier-acquisition cost belongs in blended CAC. Routine post-sale support belongs in COGS. Initial onboarding is counted once in CAC. Costs of non-billable attempts and credits are allocated to successful orders through the reserve; the pilot must measure whether KZT 8 is sufficient.', 'small')

# Page 7
page(7,'Calculate LTV, CAC and payback')
table(['Variable','Definition','Base'],[
 ['q','Completed deliveries per active paying store / month','40'],
 ['f','Starter fee per completed delivery','KZT 120'],
 ['R','Monthly platform revenue: q x f','KZT 4,800'],
 ['GP','R less direct monthly COGS','KZT 3,104'],
 ['g','GP / R','64.7%'],
 ['c','Monthly logo churn for paying stores','3.0%'],
 ['CAC','Blended monthly cost / new paying stores','KZT 24,000'],
],[CW*.12,CW*.63,CW*.25])
h('Gross-profit lifetime value')
p('Expected lifetime = 1 / c = 1 / 0.03 = <b>33.33 months</b>.<br/>LTV = R x g / c = GP / c = 3,104 / 0.03 = <b>KZT 103,467</b>.<br/>LTV / CAC = 103,466.67 / 24,000 = <b>4.31x</b>.', 'formula')
p('LTV measures lifetime <b>gross profit</b>, not lifetime revenue or courier GMV. It assumes constant monthly churn, constant order volume and margin, no expansion, no reactivation and no discounting. A 3% monthly churn assumption implies (1 - 0.03)<super>12</super> = <b>69.4% twelve-month logo retention</b>. This is unobserved and materially affects LTV.')
h('CAC payback')
p('Simple payback = CAC / monthly GP = 24,000 / 3,104 = <b>7.73 months</b>.', 'formula')
p('The monthly cohort also applies churn between months. Expected survival in month t is (1 - c)<super>t-1</super>. The first month with cumulative expected gross profit at least KZT 24,000 is <b>month 9</b>. This survival-adjusted payback is more conservative than the simple ratio.')
h('36-month capped check')
p('LTV<sub>36</sub> = GP x [1 - (1 - c)<super>36</super>] / c<br/>= 3,104 x [1 - 0.97<super>36</super>] / 0.03 = <b>KZT 68,906</b>.<br/>LTV<sub>36</sub> / CAC = 68,905.94 / 24,000 = <b>2.87x</b>.', 'formula')
p('The workbook sums 36 monthly retained-store contributions, so zero churn still produces a finite capped value. Uncapped LTV is shown as unavailable at zero churn instead of reporting an infinite figure. No residual value is added after month 36.')

# Page 8
page(8,'Benchmark the result and test failure')
p('Bessemer\'s cloud-company guide recommends gross-profit LTV/CAC of <b>3x or higher</b> and SMB CAC payback <b>below 12 months</b>. Qadam uses these as reference investment-efficiency hurdles. They are cloud benchmarks, not universal rules for a Kazakhstan delivery marketplace. Meeting a modeled ratio does not establish financing eligibility. [B1]')
table(['Test','Base result','Assessment'],[
 ['Uncapped LTV / CAC >= 3x','4.31x','Meets, conditional on assumptions'],
 ['SMB simple payback &lt; 12 months','7.73 months','Meets, conditional on assumptions'],
 ['36-month capped LTV / CAC >= 3x','2.87x','Below internal conservative hurdle'],
],[CW*.48,CW*.19,CW*.33])
h('Three scenarios evaluated through the same model')
rows=[]
for label,key,formatter in [
 ('Orders / store / month','orders',lambda x:str(int(x))),
 ('New paying stores / month','newStores',lambda x:str(int(x))),
 ('Monthly churn','churn',lambda x:f'{x:.0%}'),
 ('Blended CAC (KZT)','cac',money),
 ('Monthly gross profit (KZT)','gp',money),
 ('Uncapped LTV / CAC','ratio',lambda x:f'{x:.2f}x'),
 ('Simple payback (months)','payback',lambda x:f'{x:.2f}'),
 ('36-month LTV / CAC','ratio36',lambda x:f'{x:.2f}x'),
]: rows.append([label]+[formatter(c[key]) for c in data['cases']])
table(['Metric','Downside','Base','Upside'],rows,[CW*.46,CW*.18,CW*.18,CW*.18])
p('All cases use Starter pricing and the same KZT 480,000 monthly acquisition cost pool. Cases vary order volume, paying customer additions and churn. Downside fails both primary hurdles. Upside is a stretch assumption, not a growth forecast.', 'small')
h('What must improve')
p('At base gross profit and CAC, uncapped LTV/CAC reaches 3x only if monthly churn is at most <b>4.31%</b>. Simple payback is below 12 months at <b>29 or more deliveries/store/month</b>, holding other costs constant.')
p('To reach 3x on capped LTV, CAC must fall to <b>KZT 22,969 or less</b>. At the same acquisition budget, <b>21 paying stores/month</b> would produce CAC of KZT 22,857. Alternatively, about <b>42 orders/store/month</b> would cross the capped hurdle at unchanged CAC and churn. These are testable thresholds, not achieved results.')
p('With KZT 120,000 fixed operating overhead plus the KZT 480,000 acquisition pool, indicative operating breakeven is ceil(600,000 / 3,104) = <b>194 active Starter stores</b>. This excludes tax, capital expenditure and working-capital timing. Positive unit economics alone does not establish cash breakeven.')

# Page 9
page(9,'Validate before charging and scaling')
table(['Hypothesis','Evidence to collect','Decision rule'],[
 ['Active-time advantage','A proposed study of 10 independent shops, with at least five matched dispatch scenarios per workflow. Log all active work, corrections and failures.','Publish paired times, completion rates and sample sizes. Claim 10x only if measured aggregate As-Is / To-Be is at least 10 on the predefined scope.'],
 ['WTP at KZT 120','Offer a costed paid test to 20 qualified shops after product and launch approval. Record acceptances, refusals and reasons.','Initial gate: at least 10 opt into the paid test and at least 8 of those complete a second paid dispatch. This is a pilot gate, not proof of long-term retention.'],
 ['Acquisition efficiency','Track ad spend, referrals, sales hours, payroll allocation, onboarding and supply recruitment against first paid-store cohorts.','Target blended CAC <= KZT 22,969 for the capped 3x hurdle. A minimum of 21 payers/month is an acquisition hypothesis at the modeled budget.'],
 ['Churn and order frequency','Track first-paying-store cohorts for at least six months. Record inactive months, exits, fee collections and reason codes.','Use paid activity and a predefined churn policy. Do not infer a 33-month lifetime from a short trial. Refit the LTV model as data accumulates.'],
 ['Local service liquidity','Measure requests, acceptance timestamps, completed orders, full courier cycle and support workload in one zone.','Target >= 90% accepted within 10 minutes and >= 95% accepted orders completed. Stop geographic expansion if either fails.'],
],[CW*.22,CW*.45,CW*.33])
h('Risks that change the model')
p('<b>Low usage or seasonality:</b> fewer orders reduce margin per account and raise payback. <b>Supply gaps:</b> credits, support and courier incentives may exceed the allowance. <b>Off-platform repeat orders:</b> shops and couriers can bypass fees unless history, convenience and service deliver enough recurring value.')
p('<b>Billing and collection:</b> monthly invoicing creates receivables; LTV is an economic estimate, not a cash-flow schedule. Define payment terms and separately measure late payment and bad debt. <b>Product scope:</b> custom integrations and SLAs can create new fixed support costs and must not inherit Starter economics without a separate build.')
note('Proceed in stages', 'Use this assignment to design the commercial test. Charging fees, activating tariffs, changing courier terms and implementing paid-tier features each require the project owner\'s approval. The current report and workbook do not change the operating pilot.')

# Page 10
page(10,'References and model audit trail')
h('Project evidence')
p('<b>[T4] Qadam Delivery.</b> <i>Task 4 team report</i>, prepared 4 November 2026. Sections 02, 05-07 and evidence register. Source for the beachhead, 40 orders/month, 600-second versus 90-second model and KZT 1,500/hour assumption. Those figures were explicitly unvalidated in Task 4.', 'small')
p('<b>[P1] Qadam Delivery.</b> <i>First pricing pass and pilot tariff hypothesis</i>, updated with owner approval on 29 October 2026, and project roadmap current on 11 November 2026. The pilot allocates the entire delivery fare to the courier, uses 0% Qadam commission and does not enable automatic pricing until launch gates are closed. Proposed Task 5 platform fees are a separate commercial design.', 'small')
h('External primary sources')
p('<b>[B1] D\'Onofrio, M., Ding, E. and Atlas Editors.</b> Bessemer Venture Partners, <i>Scaling to $100 Million</i>, published 21 September 2021. CAC / CLTV section supports the 3x LTV/CAC reference and sub-12-month SMB payback target. Accessed 11 November 2026.<br/><link href="https://www.bvp.com/atlas/scaling-to-100-million" color="#28624D">bvp.com/atlas/scaling-to-100-million</link>', 'small')
p('<b>[A1] Jordan, J., Jin, L., Coolican, D. A. and Chen, A.</b> Andreessen Horowitz, <i>13 Metrics for Marketplace Companies</i>, published 21 February 2020. Supports separating GMV from revenue and monitoring match rate, market depth and time to match. Accessed 11 November 2026.<br/><link href="https://a16z.com/13-metrics-for-marketplace-companies/" color="#28624D">a16z.com/13-metrics-for-marketplace-companies/</link>', 'small')
p('<b>[M1] Team planning assumptions.</b> Proposed fees, scenario drivers, staffing, acquisition budgets, cost allocations, churn, capacity targets and commercial gates were constructed for Task 5 on 11 November 2026. They are neither interview findings nor observed commercial performance.', 'small')
h('Financial workbook map')
table(['Worksheet','Purpose and key formulas'],[
 ['Overview','Active scenario, benchmark tests and a chart of expected cumulative gross profit versus CAC.'],
 ['Inputs','Single case selector. Editable scenario and cost assumptions, provenance and benchmark links. Blue numbers are inputs.'],
 ['Pricing','As-Is / To-Be labor value, tiers, credited minimum billing and customer net benefit.'],
 ['Unit Economics','Revenue, direct COGS, fully loaded CAC, LTV, payback, retention and operating breakeven.'],
 ['Cohort','36 monthly survival probabilities and gross-profit contributions. First expected acquisition recovery month.'],
],[CW*.24,CW*.76])
p('<b>How to use.</b> Start on Overview. On Inputs, select 1 = Downside, 2 = Base or 3 = Upside. Change blue assumptions only. Select the pricing plan separately to test minimum commitments. The report presents Starter economics; enterprise scope needs its own cost estimate.', 'small')
p('<b>Model boundary.</b> KZT nominal amounts, monthly periods, before taxes. No FX conversion, market-size valuation, revenue growth, financing, discounted valuation or full cash-flow forecast is claimed. Uncapped LTV is a constant-churn approximation. The capped cohort provides a shorter-horizon check.', 'small')

def footer(c,doc):
    c.saveState()
    c.setStrokeColor(LINE);c.setLineWidth(.65);c.line(42,H-31,W-42,H-31)
    c.setFont('Arial-Bold',8);c.setFillColor(GREEN);c.drawString(42,H-23,'QADAM DELIVERY')
    c.setFont('Arial',8);c.setFillColor(MUTED);c.drawRightString(W-42,H-23,'TECHNOLOGICAL ENTREPRENEURSHIP')
    c.setStrokeColor(LINE);c.line(42,32,W-42,32)
    c.setFont('Arial',8);c.drawString(42,20,'Task 5  /  11 November 2026')
    c.drawRightString(W-42,20,f'{doc.page}')
    c.restoreState()

doc=SimpleDocTemplate(str(OUT),pagesize=A4,leftMargin=42,rightMargin=42,topMargin=49,bottomMargin=44,title='Qadam Delivery - Task 5 Business Model and Financial Unit Economics',author='Qadam Delivery Team',subject='Technological Entrepreneurship, Narxoz University')
doc.build(story,onFirstPage=footer,onLaterPages=footer)
reader=PdfReader(OUT)
texts=[page.extract_text() or '' for page in reader.pages]
(WORK/'report_text.txt').write_text('\n\n'.join(texts),encoding='utf-8')
assert len(texts)==10, f'Expected 10 designed pages; got {len(texts)}: '+str([len(t) for t in texts])
for term in ['4.31','7.73','2.87','24,000','103,467','68,906','6.67','10x','120']:
    assert term in '\n'.join(texts),f'Missing report result {term}'
assert '\ufffd' not in '\n'.join(texts),'Missing glyph in extracted text'
print(json.dumps({'output':str(OUT),'pages':len(reader.pages),'text_characters':[len(t) for t in texts]},indent=2))
