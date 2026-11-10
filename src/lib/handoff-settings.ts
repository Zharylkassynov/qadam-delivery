type Environment=Record<string,string|undefined>;

// A compatibility switch for historical LOCAL test suites only. Public deployments
// cannot disable the handoff guard, even through a mistakenly copied test setting.
export function handoffsEnabled(env:Environment=process.env){
  if(env.DELIVERY_HANDOFFS_ENABLED!==undefined&&!['true','false'].includes(env.DELIVERY_HANDOFFS_ENABLED))throw new Error('DELIVERY_HANDOFFS_ENABLED must be true or false');
  if(env.DELIVERY_HANDOFFS_ENABLED!=='false')return true;
  let local=false;
  try{const origin=new URL(env.APP_ORIGIN??''),db=new URL(env.DATABASE_URL??'');local=['localhost','127.0.0.1'].includes(origin.hostname)&&['localhost','127.0.0.1'].includes(db.hostname)&&db.pathname.endsWith('_test');}catch{}
  if(env.VERCEL==='1'||!local)throw new Error('Handoff verification cannot be disabled outside a separate local test database');
  return false;
}
export const handoffPolicy={radiusM:150,accuracyM:75,maxAgeMs:60_000,maxAttempts:5} as const;
