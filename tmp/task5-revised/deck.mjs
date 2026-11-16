import fs from 'node:fs/promises';
const root='C:/Users/zhary/OneDrive/Desktop/Qadam Delivery';
const tmp=root+'/tmp/task5-revised';
const blue='#2654E8',ink='#153346',muted='#536B83',pale='#EAF0FF';
export async function build(p){
 const econ=JSON.parse(await fs.readFile(tmp+'/economics.json','utf8'));
 const txt=(s,t,x,y,w,h,size=28,bold=false,color=ink)=>{
  const sh=s.shapes.add({geometry:'textbox',position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});
  sh.text=t;sh.text.style={typeface:'Arial',fontSize:size,bold,color,verticalAlignment:'top',autoFit:'none',insets:0,wrap:'square'};return sh;
 };
 const slides=[];
 const add=(title,subtitle,foot,notes)=>{
  const s=p.slides.add();s.background.fill='#FFFFFF';slides.push(s);
  txt(s,title,64,44,1160,68,44,true);
  if(subtitle)txt(s,subtitle,64,124,1152,66,25,false,muted);
  if(foot)txt(s,foot,64,641,1150,62,20,false,muted);
  txt(s,String(slides.length).padStart(2,'0'),1178,689,44,20,15,false,muted);
  s.speakerNotes.text=notes;return s;
 };
 const table=(s,values,y=210,height=360,widths=null,size=24)=>{
  const n=values[0].length;
  const t=s.tables.add({rows:values.length,columns:n,left:64,top:y,width:1152,height,values,columnWidths:widths??Array(n).fill(1152/n)});
  t.borders.assign({fill:'#D5DEEF',width:.6,style:'solid'});
  t.cells.block({row:0,column:0,rowCount:values.length,columnCount:n}).assign({textStyle:{typeface:'Arial',fontSize:size,color:ink},margins:{top:12,bottom:10,left:14,right:14},anchor:'center'});
  for(let r=0;r<values.length;r++)for(let c=0;c<n;c++){
   const ce=t.getCell(r,c);ce.fill=r===0?pale:(r%2===0?'#F5F7FA':'#FFFFFF');ce.text.style={typeface:'Arial',fontSize:r===0?size-1:size,color:r===0?blue:ink,bold:r===0,verticalAlignment:'middle',insets:10};
  }
  return t;
 };
 const label=(s,t,x,y,w=520)=>txt(s,t,x,y,w,44,27,true,blue);
 const source='Source: team answers, 12 November 2026. Approximate courier count is team-reported. Pricing, wallet and paid plans are not implemented commercial results.';
 const bench='Reference: Bessemer Venture Partners, Scaling to $100 Million (21 September 2021), CAC payback section. https://www.bvp.com/atlas/scaling-to-100-million Accessed 12 November 2026. The 3x and sub-12-month cloud hurdles are used as planning references, not marketplace funding criteria.';

 // 1
 let s=add('Qadam Delivery','Task 5. Business Model and Unit Economics',null,
 'Qadam is a Telegram delivery platform for Almaty. We focus on individual senders first, then small shops. We plan a launch period with zero commission. Later, the platform may charge couriers two to three percent per completed order. The exact rate and launch duration remain open. '+source);
 txt(s,'Delivery\nfor everyone',64,226,640,160,64,true);
 txt(s,'0%',64,426,205,104,100,true,blue);txt(s,'commission at launch',290,459,430,52,34,true);
 txt(s,'Future model: 2–3% from couriers.\nNo subscription.',64,572,650,76,28,false,muted);
 const bytes=await fs.readFile(tmp+'/logo.jpg');
 s.images.add({blob:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),contentType:'image/jpeg',alt:'Original Qadam logo from the supplied Task 4',position:{left:746,top:193,width:470,height:470},fit:'contain'});

 // 2
 s=add('Customers and Current Evidence','Individual senders first. Flower and other small shops later.',
 'Registration does not prove active supply. Pricing feedback and willingness to pay have not been tested.',
 'The team reported about one hundred registered couriers to the instructor and demonstrated the product. Users tested functions and the order journey. Their requests included prices, a better map, card payment and UI/UX improvements. We do not claim a pricing study, paid orders or a measured active-courier count. '+source);
 txt(s,'~100',64,214,520,102,92,true,blue);txt(s,'registered couriers',64,329,540,48,34,true);
 txt(s,'Order creation and delivery\nscenarios tested for usability.',64,414,550,102,30);
 label(s,'WHAT USERS ASKED FOR',712,213);
 txt(s,'Visible delivery prices\n\nA better map\n\nBank card payment\n\nUI/UX improvements',712,271,500,334,29);

 // 3
 s=add('Business Model Selection','A two-sided marketplace: senders request delivery, couriers fulfill it.',
 'Proposed liquidity gates: 90% of valid requests accepted within 10 minutes; 95% of accepted orders completed.',
 'We select marketplace commission, also called a rake. Couriers are the future fee-paying side. A completed delivery creates the fee, and delivery GMV is its value metric. Subscription is a poor fit for occasional senders. A fixed usage fee would ignore differences in order value. We use a temporary zero-fee launch, not an assumed freemium conversion funnel. The liquidity gates are suggested operating targets, not achieved data. '+source);
 table(s,[['Archetype','Decision and reason'],['Marketplace commission','Selected: 2–3% of completed-order value.'],['Subscription / SaaS','Rejected: payment should follow deliveries.'],['Fixed transaction fee','Not selected: one fee ignores order value.'],['Freemium / hybrid','0% is a temporary pilot, with duration still open.']],210,360,[390,762],25);

 // 4
 s=add('How Money Moves','Proposed wallet model. Example fare: KZT 1,500 at a 2% commission.',
 'Wallet top-ups are prepaid balances, not revenue. Commission arises only on completion. No fee for a cancelled order.',
 'The customer pays the courier directly. The courier funds a platform balance in advance. After a completed delivery, Qadam deducts the commission from this balance. A one-thousand-tenge top-up would leave nine hundred and seventy after one thirty-tenge commission. The customer payment is not routed through Qadam. Card collection and wallet implementation are future work. Refund and cancellation rules must be defined before launch. '+source);
 label(s,'PAYMENT FLOW',64,216);
 txt(s,'1. Client pays KZT 1,500\n    directly to the courier.\n\n2. Courier tops up the\n    Qadam platform balance.\n\n3. Qadam deducts KZT 30\n    after completion.',64,272,590,310,30);
 label(s,'ONE COMPLETED DELIVERY',747,216,465);
 txt(s,'30 ₸',747,280,460,100,82,true,blue);
 txt(s,'Qadam commission',747,391,460,44,30,true);
 txt(s,'Courier retains KZT 1,470\nbefore transport costs.\n\nWallet: KZT 1,000 becomes 970.',747,459,480,145,27);

 // 5
 s=add('Three Proposed Service Tiers','Assignment pricing architecture. No monthly subscription.',
 'Only the 0% then 2–3% direction has been discussed. Business features and the final rate require a cost and WTP test.',
 'This matrix meets the three-tier requirement without introducing a subscription. Starter is the zero-commission launch. Pro is a proposed two-percent standard service. Enterprise is a possible business service at up to three percent, with custom integrations, advanced security, a dedicated SLA and custom contracting. These enterprise capabilities are future proposals. Their costs and actual courier willingness to pay must be evaluated separately. All fees would be paid by the courier from the platform balance. '+source);
 table(s,[['','Starter / Launch','Pro / Standard','Enterprise / Future'],['Commission','0%','2% proposed','Up to 3% proposed'],['Value','Try the delivery flow','Everyday orders\nand order history','Shop dispatches\nand integrations'],['Service','Existing access\ncontrols','Standard support','Advanced security\nand dedicated SLA'],['Terms','Duration open\nNo subscription','Per completed order\nNo subscription','Custom contract\nSeparate cost check']],203,405,[175,315,315,347],23);

 // 6
 s=add('Value-Based Pricing','Primary value metric: completed-delivery GMV, not user seats.',
 'The delivery tariff itself is still undecided. Commission acceptance and wallet funding need a real courier test.',
 'Our value metric is the value of completed deliveries. At two percent, a courier pays twenty tenge for each thousand tenge of delivery income. At three percent, the fee is thirty. We reject cost plus twenty percent because server costs alone do not measure courier willingness to pay or the value of new orders. Wallet prefunding creates an additional switching cost: the courier has to set aside money and learn a new process. A zero-fee trial can reduce this friction, but its length is undecided. '+source);
 label(s,'PRICE FOLLOWS ORDER VALUE',64,220,560);
 txt(s,'Per KZT 1,000 of\ncompleted-delivery value',64,288,560,108,37,true);
 txt(s,'2% = KZT 20\n3% = KZT 30',64,447,550,116,41,true,blue);
 label(s,'WHY NOT “COST + 20%”?',717,220,500);
 txt(s,'Server cost does not measure\ncourier willingness to pay.\n\nCost-plus can miss the value\nof finding delivery orders.\n\nWallet top-ups add switching\neffort and money tied up.',717,285,500,314,29);

 // 7
 s=add('The 10× Value Hypothesis','Same illustrative order: KZT 1,500. Comparison inherited from the supplied Task 4.',
 'The 20% baseline is hypothetical, not a verified competitor fee. 10× applies to commission, not the full delivery price.',
 'There is no validated ten-times economic saving. This is the same type of hypothetical commission comparison shown in the supplied Task 4. On a fifteen-hundred-tenge order, an assumed twenty-percent fee is three hundred tenge and a two-percent fee is thirty. The reduction is two hundred and seventy tenge, or ninety percent. It does not establish a ten-times lower sender price. Comparable actual fares and courier costs must be measured. A source-based validated ten-times claim remains an evidence gap for Task 5.');
 table(s,[['For one KZT 1,500 delivery','Hypothetical baseline','Qadam proposal'],['Commission rate','20% assumed','2% proposed'],['Commission paid','KZT 300','KZT 30'],['Courier retains, before own costs','KZT 1,200','KZT 1,470']],211,292,[520,316,316],25);
 txt(s,'300 ÷ 30 = 10×',64,542,610,65,46,true,blue);
 txt(s,'KZT 270 lower commission per order',700,556,520,74,28,true);

 // 8
 s=add('Revenue and Server Break-Even','Known monthly server budget: KZT 8,300. Current map spend: KZT 0.',
 'Fare KZT 1,500 and cost KZT 5/order are assumptions. Server-only breakeven excludes acquisition and other overhead.',
 'The team gave a monthly server budget of eight thousand three hundred tenge and said the map is currently free. For illustration, assume a fifteen-hundred-tenge delivery and five tenge of platform service cost per completion. At two percent, contribution is twenty-five tenge, so three hundred and thirty-two completed deliveries cover only the server. At three percent, the result is two hundred and eight. At zero percent the pilot needs funding. Including the illustrative sixty-thousand-tenge monthly acquisition budget raises the two-percent threshold to two thousand seven hundred and thirty-two deliveries. '+source);
 table(s,[['Per completed delivery','Launch 0%','At 2%','At 3%'],['Qadam commission','KZT 0','KZT 30','KZT 45'],['Illustrative service cost','KZT 5','KZT 5','KZT 5'],['Contribution','−KZT 5','KZT 25','KZT 40'],['Orders to cover server / month','Not covered','332','208']],209,345,[480,224,224,224],24);
 txt(s,'Including the model’s KZT 60,000 acquisition pool:\n2% needs 2,732 completed deliveries/month.',64,573,1150,66,25,true);

 // 9
 s=add('Customer Acquisition Cost','Model unit: one newly monetized courier. Costs cover acquisition on both marketplace sides.',
 'All acquisition figures are assumptions. The ~100 existing registrations are not the denominator for CAC.',
 'Because the future fee comes from couriers, we measure CAC per newly monetized courier. Allocate the costs of recruiting couriers and attracting sender demand to the same commercial cohort. The illustrative monthly pool includes digital ads, channel commissions, loaded sales labor and initial onboarding. Sixty thousand tenge divided by twenty new couriers with a first commission-paying delivery equals a CAC of three thousand tenge. These are assumptions, not actual campaign results. The same denominator must never include free registrations. '+source);
 table(s,[['Illustrative monthly acquisition pool','KZT'],['Digital ads: senders and couriers','20,000'],['Channel partner commissions','5,000'],['Loaded sales / founder labor','20,000'],['Initial onboarding','15,000'],['Total','60,000']],202,345,[850,302],25);
 txt(s,'CAC = KZT 60,000 ÷ 20 new monetized couriers = KZT 3,000',64,574,1150,58,29,true,blue);

 // 10
 s=add('LTV and CAC Payback','Illustrative base case after launch: 2% fee, 20 deliveries/courier/month and 5% monthly churn.',
 'No paid cohort exists yet. Churn, order frequency and costs are unvalidated. Contribution excludes fixed server cost.',
 'At twenty deliveries a month, each producing twenty-five tenge contribution, one courier generates five hundred tenge per month for Qadam. A five-percent constant monthly churn assumption gives an expected lifetime of twenty months. LTV is monthly contribution divided by churn, which equals ten thousand tenge. Divide this by the three-thousand-tenge CAC to get three point three three. Simple payback is CAC divided by monthly contribution, or six months. There is no expansion or discounting. A thirty-six-month capped LTV gives a lower ratio of two point eight one in the workbook. These formulas do not prove retention. '+bench);
 label(s,'MONTHLY CONTRIBUTION',64,222,1150);
 txt(s,'20 orders × (KZT 30 − KZT 5) = KZT 500',64,274,1150,61,38,true);
 txt(s,'Expected lifetime = 1 ÷ 5% churn = 20 months\nLTV = KZT 500 × 20 months = KZT 10,000',64,365,1150,122,32);
 txt(s,'3.33×',64,516,440,91,72,true,blue);txt(s,'LTV / CAC: 10,000 ÷ 3,000',64,603,570,35,25);
 txt(s,'6 months',704,516,510,91,65,true,blue);txt(s,'Payback: 3,000 ÷ 500',704,603,510,35,25);

 // 11
 s=add('VC Reference Hurdles and Scenarios','Planning targets: LTV/CAC ≥ 3× and CAC payback < 12 months.',
 'Cloud benchmarks are reference hurdles, not proof of marketplace readiness. All cases below are hypothetical.',
 'We compare scenarios with common venture-efficiency hurdles. The base case passes uncapped LTV/CAC and simple payback. A downside with fewer deliveries, higher churn and fewer newly monetized couriers fails. A three-percent fee improves the arithmetic but may reduce courier acceptance; retention is held equal only to isolate the fee change. This is not a recommendation to raise the fee without testing. The thirty-six-month capped base ratio is two point eight one, below three, which shows the sensitivity to assumed lifetime. '+bench);
 table(s,[['Metric','Downside 2%','Base 2%','3% fee test'],['Orders / courier / month','10','20','20'],['Monthly churn','10%','5%','5%'],['CAC','KZT 5,000','KZT 3,000','KZT 3,000'],['LTV / CAC','0.50×','3.33×','5.33×'],['Simple payback','20 months','6 months','3.75 months']],202,372,[465,229,229,229],24);
 txt(s,'Conservative check: base LTV/CAC capped at 36 months = 2.81×.',64,588,1152,43,25,true);

 // 12
 s=add('Commercial Validation and Next Decisions','The business model is proposed. Payment and pricing decisions remain open.',
 'Benchmark source: Bessemer Venture Partners, Scaling to $100 Million (2021).\nbvp.com/atlas/scaling-to-100-million',
 'Our next step is a small commercial test, not an unsupported growth forecast. Agree the sender tariff, the length of the zero-commission launch, and whether the standard fee should be two or three percent. Confirm wallet top-ups, refunds and the low-balance rule. Card payment is a user request and remains future work. Measure actual completed deliveries per active courier, acceptance time, collection cost, fully loaded CAC and retained cohorts. Only then can the team validate value-based pricing and update the financial model. '+source+' '+bench);
 label(s,'DECISIONS STILL OPEN',64,224,560);
 txt(s,'Delivery tariff and the 0% period\n\nFinal 2% or 3% commission\n\nWallet top-ups and refunds\n\nCard payment integration',64,287,570,300,29);
 label(s,'WHAT WE MUST MEASURE',712,224,510);
 txt(s,'Courier willingness to pay\n\nOrders and repeat use\n\nAcceptance and completion\n\nReal costs, CAC and churn',712,287,520,300,29);
 return {slides:slides.length,economics:econ};
}
