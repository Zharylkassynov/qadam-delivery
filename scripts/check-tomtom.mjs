import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

// Standalone research command. Never imported by Next.js or run by CI/build.
// Secrets are loaded by Node at runtime; raw errors, URLs and responses are never printed.
const root = new URL('../', import.meta.url);
const limit = 40;
let calls = 0;
let key;
class CheckError extends Error { constructor(code) { super(code); this.code = code; } }
const point = coordinates => ({ type: 'Point', coordinates });
const finite = (value, max) => Number.isFinite(value) && value >= 0 && value <= max;
const isoDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));

function meters(a, b) {
  const rad = Math.PI / 180;
  const h = Math.sin((b[1]-a[1])*rad/2)**2 + Math.cos(a[1]*rad)*Math.cos(b[1]*rad)*Math.sin((b[0]-a[0])*rad/2)**2;
  return 12742000 * Math.asin(Math.sqrt(Math.min(1,h)));
}

async function request(url, options = {}) {
  if (url.hostname !== 'api.tomtom.com' || url.protocol !== 'https:' || ++calls > limit) throw new CheckError('REQUEST_BOUNDARY');
  await delay(600);
  const start = performance.now();
  let response;
  try { response = await fetch(url, { ...options, redirect:'error', signal:AbortSignal.timeout(20000) }); }
  catch { throw new CheckError('NETWORK_OR_TIMEOUT'); }
  const durationMs = Math.round(performance.now() - start);
  if ([401,403,429].includes(response.status)) { await response.body?.cancel(); throw new CheckError(`HTTP_${response.status}_STOPPED`); }
  // Error bodies can echo request details. Discard them, even for expected 400s.
  if (!response.ok) { await response.body?.cancel(); return { status:response.status, durationMs }; }
  const reader = response.body?.getReader();
  if (!reader) throw new CheckError('EMPTY_RESPONSE');
  const chunks = []; let size = 0;
  while (true) {
    let chunk;
    try { chunk = await reader.read(); } catch { throw new CheckError('BODY_READ_FAILED'); }
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > 2097152) { await reader.cancel(); throw new CheckError('RESPONSE_TOO_LARGE'); }
    chunks.push(chunk.value);
  }
  let data;
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new CheckError('INVALID_JSON'); }
  return { status:response.status, durationMs, data };
}

function summary(raw, version, origin, destination, requestMs, paths) {
  const travelSeconds = version === 3 ? raw?.travelDurationInSeconds : raw?.travelTimeInSeconds;
  const delaySeconds = version === 3 ? raw?.trafficDelayDurationInSeconds : raw?.trafficDelayInSeconds;
  if (!finite(raw?.lengthInMeters,150000) || raw.lengthInMeters < 10 || !finite(travelSeconds,86400) || travelSeconds === 0) throw new CheckError('INVALID_ROUTE_SUMMARY');
  const result = { meters:raw.lengthInMeters, seconds:travelSeconds, trafficDelaySeconds:finite(delaySeconds,86400)?delaySeconds:null, requestMs };
  const departure = version === 3 ? raw.departureDateTime : raw.departureTime;
  const arrival = version === 3 ? raw.arrivalDateTime : raw.arrivalTime;
  if (isoDate(departure) && isoDate(arrival)) {
    result.departureUtc = new Date(departure).toISOString();
    result.providerOffset = departure.endsWith('Z')?'Z':departure.slice(-6);
    result.durationMatchesDates = Math.abs((Date.parse(arrival)-Date.parse(departure))/1000-travelSeconds) <= 2;
  }
  if (version === 1) for (const field of ['noTrafficTravelTimeInSeconds','historicTrafficTravelTimeInSeconds','liveTrafficIncidentsTravelTimeInSeconds']) {
    if (finite(raw[field],86400)) result[field] = raw[field];
  }
  if (version === 3) {
    if (!Array.isArray(paths) || paths.length < 2 || paths.some(p=>!Array.isArray(p)||p.length!==2||!finite(p[0],180)||!finite(p[1],90))) throw new CheckError('INVALID_ROUTE_GEOMETRY');
    const originShift = Math.round(meters(origin,paths[0]));
    const destinationShift = Math.round(meters(destination,paths.at(-1)));
    result.originShiftMeters = originShift; result.destinationShiftMeters = destinationShift;
    result.endpointCheck = Math.max(originShift,destinationShift)<=500?'PASS':'REVIEW';
  }
  return result;
}

async function orbis(origin,destination,traffic='live',extra={}) {
  const r = await request(new URL('https://api.tomtom.com/maps/orbis/routing/routes/calculate'), {
    method:'POST', headers:{ 'Content-Type':'application/json', 'TomTom-Api-Version':'3', 'TomTom-Api-Key':key, Attributes:'routes' },
    body:JSON.stringify({ routePlanningLocations:{ origin:point(origin),destination:point(destination) }, travelMode:'car',routeType:'fast',traffic,departureDateTime:'now',...extra }),
  });
  if (r.status!==200) return { status:r.status,requestMs:r.durationMs };
  const route = r.data.routes?.[0];
  const paths = route?.legs?.flatMap(leg=>leg.path?.type==='LineString'?leg.path.coordinates:[]);
  return { status:r.status,...summary(route?.summary,3,origin,destination,r.durationMs,paths) };
}

async function classic(origin,destination,mode='car') {
  // The documented v1 endpoint requires a query key. It never leaves this process's request.
  const coords = `${origin[1]},${origin[0]}:${destination[1]},${destination[0]}`;
  const url = new URL(`https://api.tomtom.com/routing/1/calculateRoute/${coords}/json`);
  url.search = new URLSearchParams({ key,travelMode:mode,routeType:'fastest',traffic:'true',computeTravelTimeFor:'all',routeRepresentation:'summaryOnly',departAt:'now' }).toString();
  const r = await request(url);
  if (r.status!==200) return { status:r.status,requestMs:r.durationMs };
  return { status:r.status,...summary(r.data.routes?.[0]?.summary,1,origin,destination,r.durationMs) };
}

try {
  const args = process.argv.slice(2);
  if (args.some(a=>a!=='--offline')) throw new CheckError('USE_NO_ARGS_OR_OFFLINE');
  const fixture = JSON.parse(await readFile(new URL('scripts/fixtures/tomtom-almaty.json',root),'utf8'));
  if (fixture.routes.length!==10 || new Set(fixture.routes.map(r=>r.id)).size!==10) throw new CheckError('INVALID_FIXTURE');
  for (const p of Object.values(fixture.points)) {
    if (typeof p.label!=='string' || p.coordinates?.length!==2 || p.coordinates[0]<76.4 || p.coordinates[0]>77.4 || p.coordinates[1]<42.9 || p.coordinates[1]>43.6 || !p.coordinates.every(Number.isFinite)) throw new CheckError('INVALID_POINT');
  }
  for (const r of fixture.routes) if (!/^R\d{2}$/.test(r.id) || !fixture.points[r.from] || !fixture.points[r.to] || r.from===r.to) throw new CheckError('INVALID_PAIR');
  if (args.includes('--offline')) {
    console.log('TomTom fixture check passed: 10 public routes, no credentials or network used.');
  } else {
    try { process.loadEnvFile(fileURLToPath(new URL('.env.local',root))); }
    catch { throw new CheckError('LOCAL_CONFIGURATION_UNAVAILABLE'); }
    key = process.env.TOMTOM_API_KEY?.trim();
    if (!key || !/^[A-Za-z0-9_-]{16,128}$/.test(key)) throw new CheckError('KEY_MISSING_OR_INVALID');
    const report = { startedAtUtc:new Date().toISOString(), api:'TomTom Orbis v3 + separate TomTom Maps v1 control', limit, routes:[], controls:{} };
    for (const r of fixture.routes) {
      const a = fixture.points[r.from], b = fixture.points[r.to];
      const live = await orbis(a.coordinates,b.coordinates);
      const historical = await orbis(a.coordinates,b.coordinates,'historical');
      const classicControl = await classic(a.coordinates,b.coordinates);
      const record = { id:r.id, from:a.label, to:b.label, live,historical,classicControl };
      report.routes.push(record);
      console.log(JSON.stringify(record));
    }
    const a = fixture.points.bazaar.coordinates, b = fixture.points.dostyk.coordinates;
    report.controls.pedestrianV1 = await classic(a,b,'pedestrian');
    report.controls.motorcycleV1 = await classic(a,b,'motorcycle');
    report.controls.departurePlus15MinutesV3 = await orbis(a,b,'live',{ departureDateTime:new Date(Date.now()+900000).toISOString() });
    const invalid = await request(new URL('https://api.tomtom.com/maps/orbis/routing/routes/calculate'), {
      method:'POST', headers:{ 'Content-Type':'application/json','TomTom-Api-Version':'3','TomTom-Api-Key':key,Attributes:'routes.summary' },body:'{}',
    });
    report.controls.invalidInputStatus = invalid.status;
    report.finishedAtUtc = new Date().toISOString(); report.requests = calls;
    report.counts = {
      liveSuccess:report.routes.filter(r=>r.live.status===200).length,
      historicalSuccess:report.routes.filter(r=>r.historical.status===200).length,
      classicSuccess:report.routes.filter(r=>r.classicControl.status===200).length,
      positiveLiveDelays:report.routes.filter(r=>r.live.trafficDelaySeconds>0).length,
      endpointsPass:report.routes.filter(r=>r.live.endpointCheck==='PASS'&&r.historical.endpointCheck==='PASS').length,
    };
    const serialized = JSON.stringify(report,null,2);
    if (serialized.includes(key)) throw new CheckError('OUTPUT_PRIVACY_CHECK');
    await mkdir(new URL('artifacts/',root),{ recursive:true });
    await writeFile(new URL('artifacts/tomtom-check.json',root),serialized+'\n','utf8');
    console.log(JSON.stringify({ counts:report.counts,controls:report.controls,requests:calls,startedAtUtc:report.startedAtUtc,finishedAtUtc:report.finishedAtUtc }));
    if (report.counts.liveSuccess!==10 || report.counts.historicalSuccess!==10 || report.counts.classicSuccess!==10 || report.counts.endpointsPass!==10 || ![400,422].includes(invalid.status)) process.exitCode=1;
  }
} catch (error) {
  // Only locally defined, fixed error codes may be printed. Never stringify arbitrary errors.
  console.error(`TomTom check failed (${error instanceof CheckError?error.code:'UNEXPECTED_ERROR_DETAILS_SUPPRESSED'}); requests=${calls}.`);
  process.exitCode=1;
}
