import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root='C:/Users/zhary/OneDrive/Desktop/Qadam Delivery';
const runtime='C:/Users/zhary/.cache/codex-runtimes/codex-primary-runtime';
process.env.RUNTIME_NODE_MODULES=runtime+'/dependencies/node/node_modules';
const {Presentation,PresentationFile}=await import(pathToFileURL(process.env.RUNTIME_NODE_MODULES+'/@oai/artifact-tool/dist/artifact_tool.mjs').href);
const base=path.join(root,'.codex-artifacts/qadam-midterm');
const build=path.join(base,'build-en');
const out=path.join(root,'deliverables/Qadam-Midterm-English');
await fs.mkdir(build,{recursive:true});await fs.mkdir(out,{recursive:true});
const p=Presentation.load(JSON.parse(await fs.readFile(path.join(base,'build/deck.json'),'utf8')));
const source='https://stat.gov.kz/ru/industries/economy/local-market/publications/346330/';
const sourceDeck=path.join(root,'deliverables/Qadam-Midterm/Qadam_Delivery_Midterm.pptx');
const shapes=[
 ['Qadam Delivery','Local delivery for small businesses\nin Almaty through Telegram','Primary Market Research\n& Opportunity Defense','Task 3 / Midterm defense / October 2026','Early courier interviews and registration. Market figures include assumptions.'],
 ['Our first customer: a small shop in Almaty','A business-side hypothesis to test in a B2B pilot','Qadam Delivery','02','Who makes the decision','A shop owner or administrator\nwho arranges delivery to the buyer.','Initial customer segment','Flower and gift shops, and small sellers\nwho take orders through social media.','6.7','hours of coordination per month','40 deliveries × 10 minutes ÷ 60','Assumption: time spent finding a courier, sharing addresses and checking order status.'],
 ['Primary research: courier interviews','Completed interviews and registration. Follow-up questions appear on the right.','Qadam Delivery','03','8–10','couriers interviewed (approx.)','Qualitative research focused on\npotential delivery partners.','Couriers registered on Qadam','An early step in building local supply','01','Describe your last completed delivery.','02','How did you find that order?','03','What were the payout and travel costs?','04','When did you last wait without orders?','05','Which orders have you declined, and why?'],
 ['Early evidence from the courier side','Research scope: courier interviews and registration on the platform','Qadam Delivery','04','Next evidence: availability, accepted orders and repeat activity'],
 ['Kazakhstan’s e-commerce market is growing','Retail e-commerce turnover, KZT trillion, including marketplaces','Qadam Delivery','05','24.3%','CAGR for 2022–2025','[(3.7688 / 1.9635)^(1/3) − 1] × 100%','Nominal growth in goods turnover.\nCourier-sector growth requires\na separate estimate.','Source: Bureau of National Statistics of Kazakhstan, E-commerce, 2025'],
 ['The current Qadam Delivery MVP','A Telegram Mini App and browser version for the delivery workflow','Qadam Delivery','06','01','Create a delivery order','02','Courier accepts','03','Update delivery status','04','Restore order history','Russian-language demo.\nShared flow for B2B pilots.','GPS updates while the app is open\nand permission is granted.'],
 ['Digital alternatives and market penetration','Business-side penetration remains unmeasured: interviews covered couriers only','Qadam Delivery','07','14.3%','Online sales as a share of\nKazakhstan’s retail turnover, 2025','This measures sales turnover.\nCourier registration is an early\nonboarding signal. Local penetration\nneeds a defined market denominator.','Penetration = n / N × 100%','n = businesses using a digital delivery service\nN = all surveyed businesses in the target segment'],
 ['TAM / SAM / SOM: a working scenario','All customer counts, delivery volumes and platform fees below are assumptions','Qadam Delivery','08','50 businesses × 40 deliveries × KZT 300 × 12 = KZT 7.2m','KZT 300 is assumed platform revenue per order. Courier compensation is separate.\nSOM is annual revenue at the target scale, before expenses.'],
 ['Revenue sensitivity and the path to SOM','Scenarios with 50 active businesses. Illustrative calculations, not sales forecasts.','Qadam Delivery','09','2,000','deliveries\nper month\nin the base\nscenario','Acquisition plan: 5 pilot businesses, 20 active businesses by month 12, and 50 by month 24.','Registration alone does not establish availability, delivery capacity or repeat participation.'],
 ['Next step: a pilot with real deliveries','Proposed four-week pilot: 5 businesses and registered couriers, aiming for 50 deliveries','Qadam Delivery','10','Courier interviews and registration give us a starting point','The pilot will test paying demand, repeat use and delivery economics.']
];
for(let i=0;i<10;i++){
 const list=p.slides.items[i].shapes.items;
 if(list.length!==shapes[i].length)throw new Error('Unexpected shape count on slide '+(i+1));
 list.forEach((s,j)=>{s.text=shapes[i][j];s.name=shapes[i][j].slice(0,65)});
}
// Keep the existing visual language and improve the space below the evidence table.
p.slides.items[3].shapes.items[4].position={left:64,top:625,width:1152,height:40};
p.slides.items[3].shapes.items[4].text.style={fontSize:25};
p.slides.items[6].shapes.items[6].position={left:64,top:456,width:390,height:145};
p.slides.items[7].shapes.items[4].text.style={fontSize:32};
const tables={
 3:[
  ['Evidence','What it shows','What remains unknown'],
  ['About 8–10 courier interviews','Access to potential partners','Quantified pain and common themes'],
  ['Couriers registered on Qadam','Accounts ready for pilot invitations','Regular availability and engagement'],
  ['Order acceptance and delivery','Next stage of testing','Completion rate and repeat activity'],
  ['Paying business customers','Future customer-side research','Willingness to pay and volume']
 ],
 6:[
  ['Current alternative','Evidence to collect'],
  ['Delivery service','Frequency, price and reasons for use'],
  ['Regular courier','Availability and replacement options'],
  ['Manual arrangements','Time spent and handover errors']
 ],
 7:[
  ['Market scope','Eligible businesses','Annual Qadam revenue'],
  ['TAM: Kazakhstan','10,000','KZT 1.44bn'],
  ['SAM: Almaty','1,500','KZT 216m'],
  ['SOM: first 1–2 years','50','KZT 7.2m']
 ],
 8:[
  ['Scenario','Monthly deliveries\nper business','Revenue\nper order','Annual\nrevenue'],
  ['Conservative','25','KZT 200','KZT 3.0m'],
  ['Base','40','KZT 300','KZT 7.2m'],
  ['High','60','KZT 350','KZT 12.6m']
 ],
 9:[
  ['Test','Proposed continuation criterion'],
  ['Paying demand','3 of 5 businesses pay for the agreed pilot'],
  ['Repeat use','3 of 5 businesses order again after week one'],
  ['Value and reliability','30% less coordination time. ≥90% delivered on time'],
  ['Order economics','Positive contribution after variable costs']
 ]
};
for(const [i,values] of Object.entries(tables)){
 const t=p.slides.items[Number(i)].tables.items[0];
 values.forEach((row,r)=>row.forEach((value,c)=>{t.getCell(r,c).value=value}));
}
// Rebalance the longer English evidence table while retaining native editability.
const evidence=p.slides.items[3].tables.items[0];
evidence.columns.get(0).width=350;evidence.columns.get(1).width=390;evidence.columns.get(2).width=412;
for(let r=0;r<5;r++)for(let c=0;c<3;c++)evidence.getCell(r,c).text.style={fontSize:23};
p.slides.items[4].charts.items[0].series.getItemAt(0).name='Retail e-commerce';
const screenshot=await fs.readFile(path.join(base,'assets/qadam-demo.png'));
p.slides.items[5].images.items[0].replace({blob:screenshot,contentType:'image/png',alt:'Actual Qadam Delivery demo: Almaty map and delivery request',fit:'contain'});

const speeches=[
 `Good afternoon. We are presenting Qadam Delivery, a local delivery platform designed mainly as a Telegram Mini App. Our initial business focus is small shops in Almaty. Our primary research so far has focused on couriers. We interviewed approximately eight to ten couriers and registered couriers on our platform. Today, we will explain what this early evidence shows, introduce our market assumptions, and describe the next tests needed before scaling.`,
 `Our target paying customer is a small shop owner or administrator who arranges delivery to a buyer. We initially consider flower shops, gift shops, and small sellers using social media. Our hypothesis is that coordinating deliveries takes time. For example, forty monthly deliveries at ten minutes of coordination each would require about six point seven hours. These are working assumptions. We still need customer interviews and measurements to establish how serious this problem is for businesses.`,
 `We started with the courier side of the platform. We interviewed approximately eight to ten couriers and registered couriers on Qadam. This gave us direct contact with potential delivery partners and an initial group to involve in testing. Our sample size is approximate. For the next research round, we will apply The Mom Test principles by asking about specific past deliveries, actual payouts, travel costs, and rejected orders. These follow-up questions will help us turn conversations into more detailed evidence.`,
 `Our strongest evidence at this stage is that courier interviews took place and that we registered couriers on the platform. Registration gives us an initial group to invite into operational testing. Our next task is to observe actual behavior: when couriers are available, whether they accept suitable orders, and whether they return after their first delivery. Customer demand also needs separate research. We have not interviewed businesses yet, so willingness to pay and order frequency remain open questions.`,
 `For market context, we used official data from Kazakhstan’s Bureau of National Statistics. Retail e-commerce turnover increased from approximately one point nine six trillion tenge in 2022 to three point seven seven trillion in 2025. The compound annual growth rate is about twenty-four point three percent over three years. This calculation measures nominal goods turnover. It provides context for delivery needs, while the growth rate of courier services and demand for Qadam require separate analysis.`,
 `Our MVP provides a practical workflow for the next tests. A customer creates a delivery request, a courier accepts it, and the courier updates its status through completion. The platform stores orders and restores their history after reopening. The current interface uses Russian, which suits our initial local demo. The business pilot can use the existing customer workflow. Location updates require an open application and permission, so the map shows the courier’s last reported position and its update time.`,
 `Market penetration describes how many target customers already use digital delivery alternatives. The official fourteen point three percent figure measures online sales within national retail turnover. We need a different measure for Qadam: the share of eligible businesses using a digital delivery service. We would divide that number by all surveyed businesses in the target segment. Since our interviews covered couriers only, we cannot calculate this business-side rate yet. Courier registration is a separate onboarding indicator.`,
 `We estimated the opportunity with a bottom-up scenario. We assume ten thousand eligible businesses across Kazakhstan, fifteen hundred accessible businesses in Almaty, and an initial target of fifty active businesses within one to two years. We also assume forty deliveries per business per month and three hundred tenge in platform revenue per delivery. This gives a TAM of one point four four billion tenge, a SAM of two hundred sixteen million, and a SOM of seven point two million per year. These are assumptions about annual platform revenue before expenses.`,
 `We also checked how sensitive the model is to activity and pricing. With fifty businesses, the conservative scenario gives three million tenge annually, the base scenario gives seven point two million, and the high scenario gives twelve point six million. The base case requires two thousand deliveries per month. Reaching this volume will depend on customer acquisition, retention, and reliable courier availability. Our registrations provide a starting point, and operational testing will establish how much delivery capacity that group can actually provide.`,
 `Our next proposed step is a four-week pilot with five businesses and registered couriers, aiming for fifty completed deliveries. We will track paid participation, repeat orders, coordination time, and deliveries completed within an agreed window. We will also calculate contribution after variable costs. Our early progress is direct contact with couriers and registration on Qadam. The next stage will connect that supply to real customer orders and test whether the service creates enough value for both sides. Thank you. We are ready for your questions.`
];
const sources=[
 'PROJECT_BRIEF.md; README.md. Interview and registration facts: project team, approximately 8–10 couriers, reported 23 October 2026.',
 'PROJECT_BRIEF.md. Coordination time and order frequency are illustrative assumptions.',
 'Project team: approximately 8–10 couriers interviewed and courier registration completed. Follow-up method: https://www.momtestbook.com/',
 'Project team report. No interview quotations or quantified themes are available for this presentation.',
 source,
 'README.md; PROJECT_BRIEF.md. Actual product screenshot: https://qadam-delivery.vercel.app/, 23 October 2026. Map attribution: Geoapify, OpenMapTiles and OpenStreetMap.',
 source,
 'Illustrative bottom-up model. All eligible business counts, activity and platform revenue assumptions require validation.',
 'Illustrative sensitivity and acquisition scenarios. No claimed sales forecast or measured courier capacity.',
 'Proposed pilot design and success thresholds. These are future targets, not completed results.'
];
for(let i=0;i<10;i++)p.slides.items[i].speakerNotes.text=speeches[i]+'\n\nSources and evidence status:\n'+sources[i];
const script=['QADAM DELIVERY','Midterm Defense / English Speaking Script','Approximate duration: 6–7 minutes at a steady pace.','The speech follows the ten slides in order.','',...speeches.flatMap((text,i)=>[`SLIDE ${i+1}: ${shapes[i][0]}`,text,''])].join('\n\n');
const qa=`\n\nPOSSIBLE PANEL QUESTIONS\n\nHow many couriers did you interview?\nApproximately eight to ten. This is a qualitative sample, and the count is approximate.\n\nDid you interview business customers?\nOur interviews so far covered couriers only. Business demand and willingness to pay are the next research step.\n\nWhat does registration prove?\nIt shows initial participation in onboarding. Availability, completed orders and repeat activity still need measurement.\n\nAre the market estimates official?\nThe national e-commerce data comes from official statistics. Our business counts, delivery frequency and platform fees are assumptions used for a scenario.\n\nWhat interview conclusions can you support?\nWe can confirm the interviews and platform registration. We do not present reconstructed quotations or numerical findings that we cannot substantiate. The next round will record specific past examples and comparable measures.\n\nDoes location tracking continue after the Mini App closes?\nWe show the last reported position and timestamp. New updates require the application to remain open and location permission.\n`;
await fs.writeFile(path.join(out,'Qadam_Delivery_English_Speaking_Script.txt'),script+qa,'utf8');
await fs.writeFile(path.join(build,'speech.json'),JSON.stringify({titles:shapes.map(s=>s[0]),speeches,sources},null,2));
await fs.writeFile(path.join(build,'deck-en.json'),JSON.stringify(p.toProto()));
await (await PresentationFile.exportPptx(p)).save(path.join(build,'candidate-en.pptx'));
for(let i=0;i<10;i++){
 const png=await p.export({slide:p.slides.items[i],format:'png',scale:1});
 await fs.writeFile(path.join(build,`slide-${String(i+1).padStart(2,'0')}.png`),new Uint8Array(await png.arrayBuffer()));
 console.log('Rendered English slide '+(i+1));
}
console.log(JSON.stringify({slides:10,speechWords:speeches.join(' ').split(/\s+/).length,out}));
