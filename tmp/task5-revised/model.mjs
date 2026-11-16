import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const req=createRequire('C:/Users/zhary/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/runtime.cjs');
const {Workbook,SpreadsheetFile}=await import(pathToFileURL(req.resolve('@oai/artifact-tool')).href);
const root='C:/Users/zhary/OneDrive/Desktop/Qadam Delivery';
const out=root+'/deliverables/Qadam-Task5-Revised';
const tmp=root+'/tmp/task5-revised';
const wb=Workbook.create();
const ss=Object.fromEntries(['Overview','Inputs','Model'].map(n=>[n,wb.worksheets.add(n)]));
const v=(s,a,x)=>ss[s].getRange(a).values=[[x]];
const f=(s,a,x)=>{ss[s].getRange(a).formulas=[[x]];if(s!=='Overview')ss[s].getRange(a).format.font.color=x.includes('!')?'#247040':'#000000';};
const nf=(s,a,x='#,##0;(#,##0);"-"')=>ss[s].getRange(a).setNumberFormat(x);
const section=(s,r,t)=>{v(s,'B'+r,t);ss[s].getRange(`B${r}:F${r}`).format.fill='#E9EFFF';ss[s].getRange(`B${r}:F${r}`).format.font.bold=true;};
for(const [name,s]of Object.entries(ss)){
 s.showGridLines=false;s.getRange('A1:H65').format.font={name:'Arial',size:11,color:'#153346'};
 s.getRange('A1:H65').format.rowHeight=25;s.getRange('A1:A65').format.columnWidth=3;
 s.getRange('B1:B65').format.columnWidth=48;s.getRange('C1:C65').format.columnWidth=21;
 s.getRange('D1:D65').format.columnWidth=4;s.getRange('E1:E65').format.columnWidth=76;
 s.getRange('F1:F65').format.columnWidth=3;s.getRange('G1:H65').format.columnWidth=12;
 nf(name,'C8:C55');s.getRange('B2').format.font={name:'Arial',size:17,bold:true,color:'#153346'};
 v(name,'B5','Selected case');if(name!=='Inputs')f(name,'C5',"='Inputs'!C6");
 s.getRange('C5').format.font.color='#247040';
}
ss.Overview.tabColor='#2654E8';ss.Inputs.tabColor='#7494F2';
v('Inputs','B2','Qadam: assumptions and sources');
v('Inputs','B3','12 November 2026. KZT. Courier commission model. No subscription.');
v('Inputs','B5','Case number: 1 launch, 2 base, 3 upper, 4 downside');v('Inputs','C5',2);
ss.Inputs.getRange('C5').format.font.color='#174EAA';ss.Inputs.getRange('C5').dataValidation={rule:{type:'whole',operator:'between',formula1:1,formula2:4}};
v('Inputs','B6','Case name');f('Inputs','C6','=CHOOSE(C5,"Launch 0%","Base 2%","Upper 3%","Downside 2%")');
v('Inputs','B8','Blue numbers are editable assumptions. Team figures are identified in Sources.');
const groups=[
 [10,'Commission rate',[0,.02,.03,.02],'Team range is 2-3%; commercial cases are not activated.'],
 [16,'Orders per active courier / month',[20,20,20,10],'Illustrative activity. No delivery volume has been forecast by the team.'],
 [22,'Monthly courier churn',[.05,.05,.05,.10],'Illustrative. No monetized retention cohort exists.'],
 [28,'New monetized couriers / month',[20,20,20,12],'Hypothetical first-commission couriers. Not the 100 registrations.']
];
for(const [r,l,arr,basis]of groups){
 v('Inputs','B'+r,l+' (active)');f('Inputs','C'+r,`=IF(CHOOSE($C$5,COUNT(C${r+1}),COUNT(C${r+2}),COUNT(C${r+3}),COUNT(C${r+4}))=1,CHOOSE($C$5,C${r+1},C${r+2},C${r+3},C${r+4}),NA())`);v('Inputs','E'+r,basis);
 ss.Inputs.getRange(`B${r}:C${r}`).format.fill='#F2F5FC';ss.Inputs.getRange(`B${r}:C${r}`).format.font.bold=true;
 ['Launch','Base','Upper','Downside'].forEach((n,i)=>{v('Inputs','B'+(r+i+1),n);v('Inputs','C'+(r+i+1),arr[i]);ss.Inputs.getRange('C'+(r+i+1)).format.font.color='#174EAA';});
}
nf('Inputs','C10:C14','0.0%');nf('Inputs','C22:C26','0.0%');section('Inputs',35,'Shared assumptions and known costs');
const inputs=[
 [37,'Illustrative delivery fare',1500,'Assumption. Not a Qadam tariff or an observed average.'],
 [38,'Support allocation / order',3,'Assumption, KZT per completed order.'],
 [39,'Notifications / order',1,'Assumption, KZT per completed order.'],
 [40,'Wallet / collection cost / order',1,'Placeholder allocation. No payment-provider quote.'],
 [41,'Monthly server budget',8300,'Team-provided amount, 12 Nov 2026. No invoice verified.'],
 [42,'Current monthly map spend',0,'Team says the map is free at present.'],
 [43,'Digital acquisition spend / month',20000,'Illustrative pool covering senders and couriers.'],
 [44,'Channel commissions / month',5000,'Illustrative partner acquisition budget.'],
 [45,'Sales labor / month',20000,'Illustrative loaded founder/sales time allocation, not actual payroll.'],
 [46,'Initial onboarding / month',15000,'Illustrative onboarding budget for both sides.'],
 [47,'Registered couriers (approx.)',100,'Team-reported registrations. Does not establish active supply.'],
 [48,'Comparison commission baseline',.20,'Hypothetical Task 4 comparison. Not a verified competitor rate.'],
 [49,'Example wallet top-up',1000,'Example prepaid balance. Top-up is not commission revenue.'],
 [50,'Reference LTV/CAC hurdle',3,'Bessemer cloud reference; applied here as a planning hurdle.'],
 [51,'Reference payback ceiling',12,'Months; planning target is less than 12.'],
 [52,'Conservative LTV horizon',36,'Months. Supplemental cap, not an observed lifetime.']
];
for(const[r,l,x,basis]of inputs){v('Inputs','B'+r,l);v('Inputs','C'+r,x);v('Inputs','E'+r,basis);ss.Inputs.getRange('C'+r).format.font.color='#174EAA';}
nf('Inputs','C48','0.0%');
section('Inputs',55,'Source register');
v('Inputs','B56','Team answers, 12 Nov 2026');v('Inputs','E56','Segments, ~100 registrations, 0% then 2-3%, wallet plan, costs, feedback.');
v('Inputs','B57','Task 4 supplied by the team');v('Inputs','E57','Design reference and prior hypothetical commission comparison.');
v('Inputs','B58','New financial assumptions');v('Inputs','E58','Fare, order frequency, acquisition pool, costs per order and churn are unvalidated.');
v('Inputs','B59','Bessemer, Scaling to $100 Million');v('Inputs','E59','https://www.bvp.com/atlas/scaling-to-100-million');
v('Inputs','B60','Financial basis');v('Inputs','E60','Nominal KZT, before tax. Server is fixed overhead; top-ups are prepaid balances.');
ss.Inputs.freezePanes.freezeRows(8);

v('Model','B2','Economics per active courier');v('Model','B3','After launch. Contribution excludes fixed server cost and acquisition.');
const rows=[
 [8,'Commission rate',"='Inputs'!C10"],
 [9,'Completed orders / courier / month',"='Inputs'!C16"],
 [10,'Delivery GMV / courier / month',"=C9*'Inputs'!C37"],
 [11,'Qadam commission revenue','=C10*C8'],
 [12,'Service cost / completed order',"=SUM('Inputs'!C38:C40)"],
 [13,'Monthly variable service cost','=C9*C12'],
 [14,'Monthly contribution','=C11-C13'],
 [15,'Contribution margin','=IF(C11>0,C14/C11,"n.a.")'],
 [16,'Monthly acquisition pool',"=SUM('Inputs'!C43:C46)"],
 [17,'New monetized couriers',"='Inputs'!C28"],
 [18,'Blended CAC per monetized courier','=IF(C17>0,C16/C17,NA())'],
 [19,'Monthly churn',"='Inputs'!C22"],
 [20,'Expected lifetime (months)','=IF(C19>0,1/C19,"n.a.")'],
 [21,'Contribution LTV','=IF(C19>0,C14/C19,"n.a.")'],
 [22,'LTV / CAC','=IF(ISNUMBER(C21),C21/C18,"n.a.")'],
 [23,'Simple payback (months)','=IF(C14>0,C18/C14,"n.a.")'],
 [24,'Commission per delivery',"='Inputs'!C37*C8"],
 [25,'Contribution per delivery','=C24-C12'],
 [26,'Server-only breakeven: deliveries / month',"=IF(C25>0,ROUNDUP(SUM('Inputs'!C41:C42)/C25,0),\"n.a.\")"],
 [27,'Breakeven including acquisition pool',"=IF(C25>0,ROUNDUP((SUM('Inputs'!C41:C42)+C16)/C25,0),\"n.a.\")"],
 [28,'Courier retains / delivery before own costs',"='Inputs'!C37-C24"],
 [29,'Wallet balance after one completion',"='Inputs'!C49-C24"],
 [30,'36-month capped contribution LTV',"=IF(C19>0,C14*(1-(1-C19)^'Inputs'!C52)/C19,C14*'Inputs'!C52)"],
 [31,'36-month capped LTV / CAC','=C30/C18'],
 [32,'12-month courier retention','=(1-C19)^12'],
 [33,'Baseline commission / delivery',"='Inputs'!C37*'Inputs'!C48"],
 [34,'Commission reduction / delivery','=C33-C24']
];for(const[r,l,x]of rows){v('Model','B'+r,l);f('Model','C'+r,x);}
for(const r of [8,15,19,32])nf('Model','C'+r,'0.0%');for(const r of [22,31])nf('Model','C'+r,'0.00"x"');nf('Model','C23','0.00');
for(const r of [11,14,18,21,22,23,26,27])ss.Model.getRange(`B${r}:C${r}`).format.font.bold=true;
v('Model','B37','At 0% commission the pilot is subsidized. No acquisition payback exists.');
v('Model','B38','Churn assumes no reactivation. No volume growth, expansion or discounting is modeled.');
v('Model','B39','Courier fuel, transport and taxes are not Qadam revenue or modeled courier net profit.');

v('Overview','B2','Qadam Delivery: Task 5');v('Overview','B3','Revised courier commission model. 12 November 2026.');
v('Overview','B7','Known: server budget KZT 8,300/month; current map spend KZT 0.');
const summary=[[9,'Commission revenue / courier / month',11],[10,'Contribution / courier / month',14],[11,'Blended CAC',18],[12,'Expected lifetime (months)',20],[13,'Contribution LTV',21],[14,'LTV / CAC',22],[15,'Simple payback (months)',23],[16,'Server-only breakeven (orders/month)',26],[17,'Breakeven incl. acquisition pool',27],[18,'36-month capped LTV / CAC',31]];
for(const[r,l,sr]of summary){v('Overview','B'+r,l);f('Overview','C'+r,`='Model'!C${sr}`);}
nf('Overview','C14','0.00"x"');nf('Overview','C18','0.00"x"');nf('Overview','C15','0.00');
section('Overview',20,'Reference hurdles');
v('Overview','B21','LTV / CAC >= 3x');f('Overview','C21',"=IF(ISNUMBER(C14),IF(C14>='Inputs'!C50,\"Meets\",\"Below\"),\"Unavailable\")");
v('Overview','B22','Payback < 12 months');f('Overview','C22',"=IF(ISNUMBER(C15),IF(C15<'Inputs'!C51,\"Meets\",\"Above\"),\"Unavailable\")");
ss.Overview.getRange('C21:C22').conditionalFormats.add('containsText',{text:'Below',format:{fill:'#FCE9E5',font:{color:'#A13529'}}});
v('Overview','B25','The team has not forecast delivery volumes or validated commission acceptance.');
v('Overview','B26','Change the case selector or blue inputs. Cases are scenarios, not observed results.');
v('Overview','B27','~100 registered couriers does not mean ~100 active, paying couriers.');
v('Overview','B28','A 0% launch creates no commission revenue. The wallet and card payment are planned.');
v('Overview','B29','Enterprise pricing needs separate service-cost inputs before use.');

const cases=[];
for(const id of [1,2,3,4]){v('Inputs','C5',id);wb.recalculate();const get=(r)=>ss.Model.getRange('C'+r).values[0][0];cases.push({name:ss.Inputs.getRange('C6').values[0][0],rate:get(8),q:get(9),revenue:get(11),contribution:get(14),cac:get(18),churn:get(19),lifetime:get(20),ltv:get(21),ratio:get(22),payback:get(23),fee:get(24),perOrder:get(25),serverBreak:get(26),fullBreak:get(27),netCourier:get(28),wallet:get(29),cappedLtv:get(30),cappedRatio:get(31)});}
v('Inputs','C5',2);wb.recalculate();
const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
assert(cases[1].revenue===600&&cases[1].contribution===500&&cases[1].cac===3000,'base arithmetic');
assert(cases[1].serverBreak===332&&cases[2].serverBreak===208,'server break-even');
assert(cases[1].fullBreak===2732,'full break-even');
v('Inputs','C37',2000);wb.recalculate();assert(ss.Model.getRange('C24').values[0][0]===40,'fare change');v('Inputs','C37',1500);
v('Inputs','C24',0);wb.recalculate();assert(ss.Model.getRange('C30').values[0][0]===18000,'zero churn cap');v('Inputs','C24',.05);
v('Inputs','C5',1);wb.recalculate();assert(ss.Model.getRange('C23').values[0][0]==='n.a.','zero rate payback');v('Inputs','C5',2);
wb.recalculate();
const errors=await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!',options:{useRegex:true,maxResults:50},maxChars:1500});console.log(errors.ndjson);
for(const [s,r]of [['Overview','B2:F29'],['Inputs','B2:F34'],['Inputs','B35:F60'],['Model','B2:F39']]){const im=await wb.render({sheetName:s,range:r,scale:1.3,format:'png'});await fs.writeFile(`${tmp}/model-${s}-${r.startsWith('B35')?'bottom':'top'}.png`,new Uint8Array(await im.arrayBuffer()));}
await fs.writeFile(tmp+'/economics.json',JSON.stringify({cases,base:cases[1]},null,2));
await(await SpreadsheetFile.exportXlsx(wb)).save(out+'/Qadam_Task5_Financial_Model_EN.xlsx');
console.log(JSON.stringify({cases}));
