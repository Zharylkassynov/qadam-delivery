import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const runtimeModules = 'C:/Program Files/WindowsApps/OpenAI.CodexPrimaryRuntime.v26-1110-973-0_26.1110.973.0_x64__3k8sg7r9htsxt/dependencies/node/node_modules';
const runtimeRequire = createRequire(path.join(runtimeModules, 'runtime-loader.cjs'));
const {Workbook, SpreadsheetFile} = await import(pathToFileURL(runtimeRequire.resolve('@oai/artifact-tool')).href);
const root = 'C:/Users/zhary/OneDrive/Desktop/Qadam Delivery';
const outDir = path.join(root, 'outputs/qadam-task5-20261111');
const workDir = path.join(root, 'tmp/task5');
await fs.mkdir(outDir, {recursive: true});
const wb = Workbook.create();
const names = ['Overview', 'Inputs', 'Pricing', 'Unit Economics', 'Cohort'];
const sheets = Object.fromEntries(names.map(name => [name, wb.worksheets.add(name)]));
const ink = '#172C35', brand = '#28624D', pale = '#EAF2ED', blue = '#174EAA';
const fmtMoney = '#,##0;(#,##0);"-"';
const fmtDecimal = '#,##0.00;(#,##0.00);"-"';
const fmtRatio = '0.00"x"';
const val = (s, a, v) => sheets[s].getRange(a).values = [[v]];
const formula = (s, a, f) => { sheets[s].getRange(a).formulas = [[f]]; if (s !== 'Overview') sheets[s].getRange(a).format.font.color = f.includes('!') ? '#247040' : '#000000'; };
const num = (s, a, f = fmtMoney) => sheets[s].getRange(a).setNumberFormat(f);
const input = (row, label, value, units, basis) => {
  val('Inputs', `C${row}`, label); val('Inputs', `D${row}`, value); val('Inputs', `E${row}`, units); val('Inputs', `G${row}`, basis);
  sheets.Inputs.getRange(`D${row}`).format.font.color = blue;
};
function band(s, row, label, end='G') {
  val(s, `C${row}`, label);
  const r = sheets[s].getRange(`C${row}:${end}${row}`);
  r.format.fill = pale; r.format.font.bold = true; r.format.font.color = ink;
  r.format.borders = {bottom: {style: 'thin', color: '#C4D4CB'}};
}
for (const name of names) {
  const sh = sheets[name]; sh.showGridLines = false;
  sh.getRange('A1:L80').format.font = {name: 'Arial', size: 10, color: ink};
  sh.getRange('A1:L80').format.rowHeight = 22;
  sh.getRange('A1:B80').format.columnWidth = 2;
  sh.getRange('C1:C80').format.columnWidth = 37;
  sh.getRange('D1:D80').format.columnWidth = 18;
  sh.getRange('E1:E80').format.columnWidth = 19;
  sh.getRange('F1:F80').format.columnWidth = 3;
  sh.getRange('G1:G80').format.columnWidth = 48;
  sh.getRange('H1:L80').format.columnWidth = 14;
  sh.getRange('C1:L80').format.verticalAlignment = 'center';
  sh.getRange('D9:E80').format.horizontalAlignment = 'right';
  sh.getRange('D9:D80').setNumberFormat(fmtMoney);
  sh.getRange('C2').format.font = {name: 'Arial', size: 16, bold: true, color: ink};
  val(name, 'C5', 'Case selected');
  if (name !== 'Inputs' && name !== 'Cohort') formula(name, 'D5', "='Inputs'!D6");
  if(name !== 'Cohort') {
    sh.getRange('D5').format.font.color = '#247040';
    sh.getRange('D5').format.horizontalAlignment = 'center';
    sh.getRange('D5').format.borders = {preset: 'outside', style: 'dashed', color: '#90A99B'};
  }
}
sheets.Overview.tabColor = ink;
sheets.Inputs.tabColor = '#6D9181';
val('Inputs', 'C2', 'Assumptions and sources');
val('Inputs', 'C3', 'Planning model dated 11 November 2026. KZT. No paid cohort observed.');
val('Inputs', 'C5', 'Case number (1 / 2 / 3)'); val('Inputs', 'D5', 2);
sheets.Inputs.getRange('D5').format.font.color = blue;
sheets.Inputs.getRange('D5').dataValidation = {rule: {type: 'whole', operator: 'between', formula1: 1, formula2: 3}};
val('Inputs', 'C6', 'Case name'); formula('Inputs', 'D6', '=CHOOSE(D5,"Downside","Base","Upside")');
val('Inputs', 'C8', 'Blue numbers are editable. Green formulas link across sheets.');
band('Inputs', 10, 'Scenario drivers');
for (const [active, label, units, values, basis] of [
  [11, 'Deliveries per store / month', 'completed orders', [25,40,70], 'Base: Task 4 scenario of 40, not measured.'],
  [16, 'New paying stores / month', 'paying stores', [12,20,30], 'M1: acquisition output assumption.'],
  [21, 'Monthly store churn', 'share / month', [.06,.03,.02], 'M1: flat logo churn; no observed retention.']
]) {
  val('Inputs', `C${active}`, `${label}: active`); val('Inputs', `E${active}`, units); val('Inputs', `G${active}`, basis);
  const first = active + 1;
  formula('Inputs', `D${active}`, `=IF(CHOOSE($D$5,COUNT(D${first}),COUNT(D${first+1}),COUNT(D${first+2}))=1,CHOOSE($D$5,D${first},D${first+1},D${first+2}),NA())`);
  sheets.Inputs.getRange(`C${active}:E${active}`).format.fill = '#F1F5F2';
  sheets.Inputs.getRange(`C${active}:D${active}`).format.font.bold = true;
  ['Downside','Base','Upside'].forEach((c,i) => input(first+i,c,values[i],units,'Scenario assumption'));
}
num('Inputs', 'D21:D24', '0.0%');
band('Inputs', 26, 'Pricing, value and operating costs');
const assumptions = [
  [27,'Starter platform fee',120,'KZT / completion','M1: proposed value-based fee; unvalidated WTP.'],
  [28,'Pro platform fee',90,'KZT / completion','M1: proposed fee for a volume commitment.'],
  [29,'Enterprise platform fee',60,'KZT / completion','M1: proposed fee; custom scope must be costed.'],
  [30,'Pro monthly commitment',100,'completed orders','M1: monthly minimum credited to usage.'],
  [31,'Enterprise monthly commitment',500,'completed orders','M1: monthly minimum credited to usage.'],
  [32,'Plan (1 Starter, 2 Pro, 3 Ent.)',1,'plan number','Change this to test another pricing plan.'],
  [33,'Cohort horizon',36,'months','Fixed 36-month conservative observation window.'],
  [34,'Manual coordination time',600,'seconds / order','T4: 10 minutes. Scenario, not an observed result.'],
  [35,'Qadam coordination time',90,'seconds / order','T4: 1.5 minutes. Scenario, not an observed result.'],
  [36,'10x engineering target',60,'seconds / order','M1: 600 / 60 = 10x target, not validation.'],
  [37,'Shop labor capacity value',1500,'KZT / hour','T4: hypothetical loaded hourly labor value.'],
  [38,'One-time shop setup time',30,'minutes','M1: shop switching cost, separate from Qadam CAC.'],
  [39,'Illustrative courier fare',1500,'KZT / delivery','M1: arithmetic example, not a live fare quote.'],
  [40,'Payment processing rate',.02,'share of platform bill','M1: applies to Qadam fee only. Not a vendor quote.'],
  [41,'Maps and notifications',5,'KZT / completion','M1: all related requests allocated per completed order.'],
  [42,'Order support cost',12,'KZT / completion','M1: incremental support allocation.'],
  [43,'Service-credit reserve',8,'KZT / completion','M1: expected credits and failed-attempt allocation.'],
  [44,'Ongoing account support',500,'KZT / store / month','M1: post-sale support. Excludes initial onboarding.'],
  [45,'Account infrastructure',100,'KZT / store / month','M1: allocated account-level hosting.'],
  [46,'Digital advertising budget',80000,'KZT / month','M1: assumed acquisition spend.'],
  [47,'Channel partner commissions',40000,'KZT / month','M1: partner acquisition expense.'],
  [48,'Sales staffing',.5,'FTE','M1: founder labor valued at replacement cost.'],
  [49,'Full-time sales salary',480000,'KZT / FTE / month','M1: salary assumption, before employer load.'],
  [50,'Employer payroll load',.20,'share of salary','M1: budgeting allowance, not a statutory tax rate.'],
  [51,'Initial onboarding budget',40000,'KZT / month','M1: full monthly budget, including unused capacity.'],
  [52,'Courier acquisition allocation',32000,'KZT / month','M1: supply-side acquisition allocated to this cohort.'],
  [53,'Fixed engineering / tools',70000,'KZT / month','M1: incremental fixed overhead, beyond per-account COGS.'],
  [54,'Fixed administration',50000,'KZT / month','M1: administration overhead.'],
  [55,'LTV / CAC threshold',3,'multiple','B1: venture benchmark, not a funding guarantee.'],
  [56,'SMB CAC payback threshold',12,'months','B1: target less than 12 months.'],
  [57,'Initial local shop cluster',10,'shops','M1: proposed one-zone launch scope.'],
  [58,'Monthly dispatch days',26,'days / month','M1: operating calendar assumption.'],
  [59,'Peak request arrival rate',5,'requests / hour','M1: peak-hour capacity example.'],
  [60,'Full courier cycle time',45,'minutes / order','M1: pickup, trip and handover. Requires measurement.'],
  [61,'Target courier utilization',.70,'share of time','M1: capacity buffer; not match-rate definition.'],
  [62,'Backup couriers',2,'couriers','M1: proposed roster buffer.']
];
assumptions.forEach(args => input(...args));
sheets.Inputs.getRange('D33').format.font.color = ink;
num('Inputs','D40','0.0%'); num('Inputs','D48','0.0'); num('Inputs','D50','0.0%'); num('Inputs','D61','0.0%');
sheets.Inputs.getRange('D32').dataValidation = {rule:{type:'whole',operator:'between',formula1:1,formula2:3}};
sheets.Inputs.getRange('D21:D24').dataValidation = {rule:{type:'decimal',operator:'between',formula1:0,formula2:1}};
band('Inputs', 65, 'Source register');
[
  ['T4','Qadam Delivery Task 4, team report, 4 November 2026. Sections 02, 05-07.'],
  ['P1','Qadam pricing pilot, owner-approved 29 October 2026. 0% courier commission.'],
  ['B1','Bessemer Venture Partners, Scaling to $100 Million (2021), CAC section.'],
  ['A1','Andreessen Horowitz, 13 Metrics for Marketplace Companies (2020).'],
  ['M1','Task 5 planning assumptions and proposed tariffs, 11 November 2026.']
].forEach(([id,t],i) => {val('Inputs',`C${66+i}`,id);val('Inputs',`D${66+i}`,t);});
val('Inputs','D72','https://www.bvp.com/atlas/scaling-to-100-million');
val('Inputs','D73','https://a16z.com/13-metrics-for-marketplace-companies/');
val('Inputs','C75','B1 and A1 accessed 11 November 2026. All commercial assumptions require field data.');
sheets.Inputs.freezePanes.freezeRows(10);

val('Pricing','C2','Value and pricing');
val('Pricing','C3','Single value metric: completed delivery coordinated for a paying shop.');
const pform = (r,label,f) => {val('Pricing',`C${r}`,label);formula('Pricing',`D${r}`,f);};
sheets.Pricing.getRange('C8:F8').values = [['Time / value per order','As-Is','To-Be','10x target']];
sheets.Pricing.getRange('C8:F8').format = {fill:ink,font:{color:'#FFFFFF',bold:true},horizontalAlignment:'center'};
formula('Pricing','D9',"='Inputs'!D34"); formula('Pricing','E9',"='Inputs'!D35"); formula('Pricing','F9',"='Inputs'!D36"); val('Pricing','C9','Active seconds');
val('Pricing','C10','Coordination labor value (KZT)');
for(const col of ['D','E','F']) {formula('Pricing',`${col}10`,`=${col}9/3600*'Inputs'!$D$37`); num('Pricing',`${col}10`,fmtDecimal);}
val('Pricing','C11','Efficiency multiple');
for(const col of ['D','E','F']) {formula('Pricing',`${col}11`,`=$D$9/${col}9`);num('Pricing',`${col}11`,fmtRatio);}
val('Pricing','C12','Released labor value (KZT)');
for(const col of ['D','E','F']) {formula('Pricing',`${col}12`,`=$D$10-${col}10`);num('Pricing',`${col}12`,fmtDecimal);}
pform(14,'Monthly released labor value',"=E12*'Inputs'!D11");
pform(15,'One-time shop switching cost',"='Inputs'!D38/60*'Inputs'!D37");
sheets.Pricing.getRange('C17:H17').values = [['Plan','Fee KZT','Min. orders','Min. bill KZT','Value captured','Proposed scope']];
sheets.Pricing.getRange('C17:H17').format = {fill:ink,font:{color:'#FFFFFF',bold:true},horizontalAlignment:'center'};
sheets.Pricing.getRange('F17:F20').format.columnWidth = 18;
sheets.Pricing.getRange('G17:G20').format.columnWidth = 18;
sheets.Pricing.getRange('H17:H20').format.columnWidth = 42;
sheets.Pricing.getRange('H18:H20').setNumberFormat('  @');
for(const [r,n,fr,mr,scope] of [[18,'Starter',27,null,'Core coordination, saved history'],[19,'Pro',28,30,'Batch entry and CSV reporting'],[20,'Enterprise',29,31,'Custom API, SLA and access controls']]) {
  val('Pricing',`C${r}`,n);formula('Pricing',`D${r}`,`='Inputs'!D${fr}`);
  if(mr)formula('Pricing',`E${r}`,`='Inputs'!D${mr}`); else val('Pricing',`E${r}`,0);
  formula('Pricing',`F${r}`,`=D${r}*E${r}`);formula('Pricing',`G${r}`,`=D${r}/$E$12`);val('Pricing',`H${r}`,scope);
}
num('Pricing','D18:F20');num('Pricing','G18:G20','0.0%');
pform(22,'Selected plan',"=CHOOSE('Inputs'!D32,C18,C19,C20)");
pform(23,'Fee per completion',"=CHOOSE('Inputs'!D32,D18,D19,D20)");
pform(24,'Committed minimum orders',"=CHOOSE('Inputs'!D32,E18,E19,E20)");
pform(25,'Billable order equivalents',"=MAX('Inputs'!D11,D24)");
pform(26,'Monthly platform bill', '=D25*D23');
pform(27,'Effective fee / actual order',"=IF('Inputs'!D11>0,D26/'Inputs'!D11,NA())");
pform(28,'Monthly customer benefit',"=E12*'Inputs'!D11");
pform(29,'Net monthly customer benefit','=D28-D26');
pform(30,'First-month net after setup','=D29-D15');
pform(31,'Gross customer benefit / fee','=IF(D26>0,D28/D26,NA())');num('Pricing','D31',fmtRatio);
pform(33,'As-Is cost incl. courier / order',"=D10+'Inputs'!D39");
pform(34,'To-Be cost incl. courier / order',"=E10+D27+'Inputs'!D39");
pform(35,'Total-cost improvement','=D33/D34');num('Pricing','D35',fmtRatio);num('Pricing','D33:D34',fmtDecimal);
val('Pricing','C37','10x is an unvalidated engineering target. The base model retains Task 4 timing.');
val('Pricing','C38','The monthly minimum is a usage credit, not an extra subscription charge.');
val('Pricing','C39','Pro and Enterprise capabilities require development and separate approval.');
band('Pricing',41,'Local courier capacity sizing','H');
pform(42,'Initial shop cluster',"='Inputs'!D57");
pform(43,'Expected deliveries / dispatch day',"=D42*'Inputs'!D11/'Inputs'!D58");num('Pricing','D43','0.0');
pform(44,'Couriers online at modeled peak',"=ROUNDUP('Inputs'!D59*'Inputs'!D60/60/'Inputs'!D61,0)");
pform(45,'Roster including backup couriers',"=D44+'Inputs'!D62");
val('Pricing','C47','Capacity figures are test assumptions, not available or committed courier supply.');

val('Unit Economics','C2','Unit economics per paying store');
val('Unit Economics','C3','KZT per month unless stated. Courier fare is a pass-through.');
const eform = (r,label,f) => {val('Unit Economics',`C${r}`,label);formula('Unit Economics',`D${r}`,f);};
band('Unit Economics',7,'Revenue');
eform(8,'New paying stores / month',"='Inputs'!D16");
eform(9,'Completed orders / store / month',"='Inputs'!D11");
eform(10,'Platform fee / completion',"='Pricing'!D23");
eform(11,'Monthly minimum order equivalents',"='Pricing'!D24");
eform(12,'Net platform revenue',"='Pricing'!D26");
eform(13,'Courier delivery GMV',"=D9*'Inputs'!D39");
eform(14,'Total customer spend','=SUM(D12:D13)');
eform(15,'Platform fee / courier GMV','=IF(D13>0,D12/D13,NA())');num('Unit Economics','D15','0.0%');
val('Unit Economics','G15','Fee ratio; no deduction from courier earnings.');
band('Unit Economics',17,'Direct service costs');
eform(18,'Maps and notifications',"=D9*'Inputs'!D41");
eform(19,'Order-level support',"=D9*'Inputs'!D42");
eform(20,'Service credits / failed attempts',"=D9*'Inputs'!D43");
eform(21,'Payment processing on platform fee',"=D12*'Inputs'!D40");
eform(22,'Ongoing account support',"='Inputs'!D44");
eform(23,'Account infrastructure',"='Inputs'!D45");
eform(24,'Total direct COGS','=SUM(D18:D23)');
eform(25,'Monthly gross profit','=D12-D24');
eform(26,'Gross margin','=IF(D12>0,D25/D12,NA())');num('Unit Economics','D26','0.0%');
band('Unit Economics',28,'Blended customer acquisition cost');
eform(29,'Digital advertising',"='Inputs'!D46");
eform(30,'Channel partner commissions',"='Inputs'!D47");
eform(31,'Sales salary allocation',"='Inputs'!D48*'Inputs'!D49");
eform(32,'Employer payroll allowance',"=D31*'Inputs'!D50");
eform(33,'Initial onboarding budget',"='Inputs'!D51");
eform(34,'Courier acquisition allocation',"='Inputs'!D52");
eform(35,'Monthly acquisition cost pool','=SUM(D29:D34)');
eform(36,'Blended CAC per paying store','=IF(D8>0,D35/D8,NA())');
val('Unit Economics','G36','New paying stores only. Free registrations excluded.');
band('Unit Economics',38,'Lifetime value, retention and payback');
eform(39,'Monthly logo churn',"='Inputs'!D21");num('Unit Economics','D39','0.0%');
eform(40,'Expected lifetime (months)','=IF(D39>0,1/D39,"n.a.")');num('Unit Economics','D40','0.00');
eform(41,'Uncapped gross-profit LTV','=IF(D39>0,D25/D39,"n.a.")');
eform(42,'Uncapped LTV / CAC','=IF(ISNUMBER(D41),D41/D36,"n.a.")');num('Unit Economics','D42',fmtRatio);
eform(43,'Simple CAC payback (months)','=IF(D25>0,D36/D25,"n.a.")');num('Unit Economics','D43','0.00');
eform(44,'36-month gross-profit LTV',"=SUM('Cohort'!F15:F50)");
eform(45,'36-month LTV / CAC','=D44/D36');num('Unit Economics','D45',fmtRatio);
eform(46,'12-month logo retention','=(1-D39)^12');num('Unit Economics','D46','0.0%');
eform(47,'Max monthly churn for 3x LTV',"=D25/('Inputs'!D55*D36)");num('Unit Economics','D47','0.0%');
eform(48,'Max CAC for 3x capped LTV',"=D44/'Inputs'!D55");
eform(50,'Fixed monthly operating overhead',"=SUM('Inputs'!D53:D54)");
eform(51,'Active stores for operating breakeven','=IF(D25>0,ROUNDUP((D50+D35)/D25,0),"n.a.")');
eform(53,'Survival-adjusted payback (months)',"=IF(MIN('Cohort'!I15:I50)=9999,\"n.a.\",MIN('Cohort'!I15:I50))");
val('Unit Economics','G51','Includes ongoing acquisition pool. Excludes tax and capex.');
val('Unit Economics','C55','LTV assumes flat order volume and margin, constant churn, no expansion or discounting.');
val('Unit Economics','C56','Costs of failed attempts are allocated to completed deliveries. Measure this in the pilot.');
sheets['Unit Economics'].freezePanes.freezeRows(7);
for(const row of [12,24,25,35,36,41,44])sheets['Unit Economics'].getRange(`C${row}:D${row}`).format.font.bold = true;

val('Cohort','C2','36-month retained-store cohort');
val('Cohort','C3','One acquired paying store. Month 1 contributes in full; churn applies between months.');
formula('Cohort','F5',"='Inputs'!D6");
sheets.Cohort.getRange('F5').format.horizontalAlignment='center';
sheets.Cohort.getRange('F5').format.borders={preset:'outside',style:'dashed',color:'#90A99B'};
[['C8','Starting store equivalents'],['C9','Monthly logo churn'],['C10','Monthly gross profit'],['C11','Initial acquisition cost']].forEach(([a,t]) => val('Cohort',a,t));
val('Cohort','F8',1);formula('Cohort','F9',"='Unit Economics'!D39");num('Cohort','F9','0.0%');
formula('Cohort','F10',"='Unit Economics'!D25");formula('Cohort','F11',"='Unit Economics'!D36");num('Cohort','F10:F11');
sheets.Cohort.getRange('C14:I14').values = [['Month','Survival','Revenue KZT','Gross profit','Cumulative GP','Net after CAC','Payback month']];
sheets.Cohort.getRange('C14:I14').format = {fill:ink,font:{color:'#FFFFFF',bold:true},horizontalAlignment:'center'};
sheets.Cohort.getRange('C14:C50').format.columnWidth = 10;
sheets.Cohort.getRange('D14:I50').format.columnWidth = 18;
sheets.Cohort.getRange('J14:L14').values = [['Month','Cumulative GP','CAC']];
for(let r=15;r<=50;r++) {
  if(r===15){val('Cohort',`C${r}`,1);formula('Cohort',`D${r}`,'=$F$8');}else{formula('Cohort',`C${r}`,`=C${r-1}+1`);formula('Cohort',`D${r}`,`=D${r-1}*(1-$F$9)`);}
  formula('Cohort',`E${r}`,`=IF(C${r}<='Inputs'!$D$33,D${r}*'Unit Economics'!$D$12,0)`);
  formula('Cohort',`F${r}`,`=IF(C${r}<='Inputs'!$D$33,D${r}*$F$10,0)`);
  formula('Cohort',`G${r}`,r===15?`=F${r}`:`=G${r-1}+F${r}`);
  formula('Cohort',`H${r}`,`=G${r}-$F$11`);
  formula('Cohort',`I${r}`,`=IF(H${r}>=0,C${r},9999)`);
  formula('Cohort',`J${r}`,`="M"&C${r}`);formula('Cohort',`K${r}`,`=G${r}`);formula('Cohort',`L${r}`,'=$F$11');
}
num('Cohort','D15:D50','0.0%');num('Cohort','E15:H50');num('Cohort','I15:I50','[=9999]"-";0');
val('Cohort','C52','Expected store fractions are survival probabilities, not observed customer counts.');
val('Cohort','C53','No residual value is added beyond month 36. Undiscounted model.');
sheets.Cohort.freezePanes.freezeRows(14);
sheets.Cohort.getRange('H15:H50').conditionalFormats.add('cellIs',{operator:'lessThan',formula:0,format:{font:{color:'#A13529'}}});

val('Overview','C2','Qadam Delivery');
val('Overview','C3','Task 5. Business model and financial unit economics');
val('Overview','C7','Planning assumptions. Pricing and retention require validation.');
sheets.Overview.getRange('C9:E9').values = [['Metric','Active case','Unit / target']];
sheets.Overview.getRange('C9:E9').format = {fill:ink,font:{color:'#FFFFFF',bold:true},horizontalAlignment:'center'};
const summaryRows = [
  [10,'Platform revenue',12,'KZT / store / month'],[11,'Direct service costs',24,'KZT / store / month'],
  [12,'Monthly gross profit',25,'KZT / store / month'],[13,'Gross margin',26,'share of revenue'],
  [14,'Blended CAC',36,'KZT / new paying store'],[15,'Expected lifetime',40,'months'],
  [16,'Uncapped LTV',41,'KZT / acquired store'],[17,'Uncapped LTV / CAC',42,'target >= 3x'],
  [18,'Simple CAC payback',43,'target < 12 months'],[19,'Survival-adjusted payback',53,'months'],
  [20,'36-month LTV',44,'KZT / acquired store'],[21,'36-month LTV / CAC',45,'conservative test >= 3x'],
  [22,'12-month logo retention',46,'share of original cohort'],[23,'Operating breakeven',51,'active paying stores']
];
for(const [r,label,src,u] of summaryRows){val('Overview',`C${r}`,label);formula('Overview',`D${r}`,`='Unit Economics'!D${src}`);val('Overview',`E${r}`,u);}
num('Overview','D13','0.0%');num('Overview','D22','0.0%');num('Overview','D15','0.0');
num('Overview','D17',fmtRatio);num('Overview','D21',fmtRatio);num('Overview','D18','0.00');
band('Overview',25,'Benchmark tests','E');
val('Overview','C26','Uncapped LTV / CAC');formula('Overview','D26',"=IF(ISNUMBER(D17),IF(D17>='Inputs'!D55,\"Meets target\",\"Below target\"),\"Unavailable\")");
val('Overview','C27','Simple CAC payback');formula('Overview','D27',"=IF(ISNUMBER(D18),IF(D18<'Inputs'!D56,\"Meets target\",\"Above target\"),\"Unavailable\")");
val('Overview','C28','36-month LTV / CAC');formula('Overview','D28',"=IF(D21>='Inputs'!D55,\"Meets target\",\"Below target\")");
sheets.Overview.getRange('D26:D28').conditionalFormats.add('containsText',{text:'Below',format:{fill:'#FBE7E2',font:{color:'#A13529',bold:true}}});
sheets.Overview.getRange('D26:D28').conditionalFormats.add('containsText',{text:'Above',format:{fill:'#FBE7E2',font:{color:'#A13529',bold:true}}});
val('Overview','C30','Base commercial proposal: KZT 120 / completion. Current pilot commission stays 0%.');
val('Overview','C31','Current time hypothesis: 600 / 90 = 6.67x. The 10x target has not been measured.');
val('Overview','C32','To test assumptions, change the case number or a blue value on Inputs.');
val('Overview','C33','Capped LTV is below 3x in Base. A favorable formula result is conditional on validation.');
val('Overview','C34','Bessemer cloud benchmarks are used as reference hurdles for this delivery platform.');
sheets.Overview.getRange('E10:E23').format.horizontalAlignment = 'left';
sheets.Overview.getRange('E10:E23').setNumberFormat('  @');
sheets.Overview.getRange('G1:L35').format.columnWidth = 11;
const chart = sheets.Overview.charts.add('line',sheets.Cohort.getRange('J14:L50'));
chart.setPosition('G9','M27');chart.title='Expected cohort payback (KZT)';
chart.titleTextStyle.typeface='Arial';chart.titleTextStyle.fontSize=13;
chart.legend={position:'top',textStyle:{typeface:'Arial',fontSize:11}};
chart.xAxis={axisType:'textAxis',textStyle:{typeface:'Arial',fontSize:10}};
chart.yAxis={numberFormatCode:'#,##0',numberFormatSourceLinked:false,textStyle:{typeface:'Arial',fontSize:10}};
chart.series.items[0].line={fill:brand,style:'solid',width:2};
chart.series.items[1].line={fill:'#87938F',style:'dashed',width:2};
chart.series.items[0].fill=brand;chart.series.items[1].fill='#87938F';
for(const r of [13,17,21,22])sheets.Overview.getRange(`C${r}:D${r}`).format.font.italic=true;
for(const r of [12,14,17,18,21])sheets.Overview.getRange(`C${r}:D${r}`).format.font.bold=true;
for(const r of [15,26,39,42,45,46,47])sheets['Unit Economics'].getRange(`C${r}:D${r}`).format.font.italic=true;

// Evaluate every scenario through the same calculation build and retain results for the PDF.
const caseResults = [];
const numericAt=(s,a) => sheets[s].getRange(a).values[0][0];
for(const id of [1,2,3]) {
  val('Inputs','D5',id);wb.recalculate();
  caseResults.push({case:numericAt('Inputs','D6'),orders:numericAt('Inputs','D11'),newStores:numericAt('Inputs','D16'),churn:numericAt('Inputs','D21'),revenue:numericAt('Unit Economics','D12'),cogs:numericAt('Unit Economics','D24'),gp:numericAt('Unit Economics','D25'),margin:numericAt('Unit Economics','D26'),cac:numericAt('Unit Economics','D36'),ltv:numericAt('Unit Economics','D41'),ratio:numericAt('Unit Economics','D42'),payback:numericAt('Unit Economics','D43'),ltv36:numericAt('Unit Economics','D44'),ratio36:numericAt('Unit Economics','D45'),retention:numericAt('Unit Economics','D46'),cacCap36:numericAt('Unit Economics','D48'),breakeven:numericAt('Unit Economics','D51'),adjustedPayback:numericAt('Unit Economics','D53')});
}
val('Inputs','D5',2);wb.recalculate();
const checks=[];
function assertClose(name,actual,expected,tol=1e-6){if(typeof actual!=='number'||Math.abs(actual-expected)>tol)throw new Error(`${name}: ${actual} != ${expected}`);checks.push(name);}
assertClose('Base revenue',numericAt('Unit Economics','D12'),4800);
assertClose('Base gross profit',numericAt('Unit Economics','D25'),3104);
assertClose('Base CAC',numericAt('Unit Economics','D36'),24000);
assertClose('Base capped LTV',numericAt('Unit Economics','D44'),3104*(1-.97**36)/.03);
assertClose('Value per delivery',numericAt('Pricing','E12'),212.5);
// Representative input changes and boundary conditions, always restored.
val('Inputs','D27',130);wb.recalculate();assertClose('Fee change updates revenue',numericAt('Unit Economics','D12'),5200);
val('Inputs','D27',120);
val('Inputs','D32',2);wb.recalculate();assertClose('Pro minimum charge',numericAt('Unit Economics','D12'),9000);
val('Inputs','D32',3);wb.recalculate();assertClose('Enterprise minimum charge',numericAt('Unit Economics','D12'),30000);
val('Inputs','D32',1);
val('Inputs','D23',0);wb.recalculate();assertClose('Zero churn gives finite capped LTV',numericAt('Unit Economics','D44'),3104*36);
if(numericAt('Unit Economics','D41')!=='n.a.')throw new Error('Zero churn should not yield an infinite numeric LTV');
val('Inputs','D23',.03);
val('Inputs','D12',null);wb.recalculate();assertClose('Missing unselected case is independent',numericAt('Unit Economics','D12'),4800);
val('Inputs','D5',1);wb.recalculate();
const missing=numericAt('Inputs','D11');if(!JSON.stringify(missing).includes('#N/A'))throw new Error(`Selected missing case must be visible, got ${JSON.stringify(missing)}`);
val('Inputs','D12',25);val('Inputs','D5',2);
wb.recalculate();
const overviewCheck=await wb.inspect({kind:'table',range:'Overview!C9:E28',include:'values,formulas',tableMaxRows:20,tableMaxCols:3,maxChars:5000});
await fs.writeFile(path.join(workDir,'model-inspection.ndjson'),overviewCheck.ndjson);
const err=await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:100},summary:'Final formula error scan',maxChars:2500});
await fs.writeFile(path.join(workDir,'formula-errors.ndjson'),err.ndjson);
console.log('Formula error scan:',err.ndjson);
console.log('Checks:',checks.length);
await fs.writeFile(path.join(workDir,'model_results.json'),JSON.stringify({cases:caseResults,checks,base:caseResults[1]},null,2));
const renderSpecs=[['Overview','C2:M35','overview'],['Inputs','C2:H41','inputs_top'],['Inputs','C42:H75','inputs_bottom'],['Pricing','C2:H47','pricing'],['Unit Economics','C2:H36','economics_top'],['Unit Economics','C38:H56','economics_bottom'],['Cohort','C2:I32','cohort_top'],['Cohort','C33:I53','cohort_bottom']];
for(const [s,r,n] of renderSpecs.filter(spec=>process.argv.includes('--cohort-only')?spec[2]==='cohort_top':(!process.argv.includes('--changed-only')||spec[0]!=='Inputs'))){
  const preview=await wb.render({sheetName:s,range:r,scale:1.5,format:'png'});
  await fs.writeFile(path.join(workDir,`${n}.png`),new Uint8Array(await preview.arrayBuffer()));
}
const xlsx = await SpreadsheetFile.exportXlsx(wb);
const outputPath=path.join(outDir,'Qadam_Task5_Unit_Economics_EN.xlsx');
await xlsx.save(outputPath);
console.log(JSON.stringify({output:outputPath,base:caseResults[1],series:chart.series.items.map(s=>({values:s.formula,categories:s.categoryFormula}))}));
