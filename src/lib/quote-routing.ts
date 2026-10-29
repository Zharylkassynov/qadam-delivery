import { z } from 'zod';
import { AppError } from './errors';
import type { MapPoint } from './types';

const point=z.object({latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180)});
const seconds=z.number().int().min(0).max(14400);
const responseSchema=z.object({routes:z.array(z.object({summary:z.object({
  lengthInMeters:z.number().int().min(1).max(100000),travelTimeInSeconds:seconds.min(1),
  noTrafficTravelTimeInSeconds:seconds,historicTrafficTravelTimeInSeconds:seconds,
  liveTrafficIncidentsTravelTimeInSeconds:seconds,
}),legs:z.array(z.object({points:z.array(point).min(2).max(10000)})).length(1)})).length(1)});
export type QuoteRoute={distanceM:number;durationS:number;provider:'TOMTOM_V1';measuredAt:Date;paths:[number,number][][]};
const unavailable='Не удалось рассчитать дорогу с данными о дорожной ситуации. Повторите попытку.';

// Candidate adapter only. No call occurs unless an owner-approved tariff is enabled.
// https://docs.tomtom.com/routing-api/documentation/tomtom-maps/v1/calculate-route
export async function quoteRoute(a:MapPoint,b:MapPoint):Promise<QuoteRoute>{
  const key=process.env.TOMTOM_API_KEY?.trim();
  if(!key||!/^[A-Za-z0-9_-]{16,128}$/.test(key))throw new AppError(503,'Расчёт стоимости временно недоступен.');
  const url=new URL(`https://api.tomtom.com/routing/1/calculateRoute/${a.latitude},${a.longitude}:${b.latitude},${b.longitude}/json`);
  url.search=new URLSearchParams({key,travelMode:'car',routeType:'fastest',traffic:'true',computeTravelTimeFor:'all',routeRepresentation:'polyline',departAt:'now'}).toString();
  try{
    const measuredAt=new Date();
    const response=await fetch(url,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});
    if(response.status===429)throw new AppError(429,'Сервис расчёта перегружен. Повторите немного позже.');
    if(!response.ok||!response.body)throw new AppError(503,unavailable);
    const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1048576){await reader.cancel();throw new AppError(503,unavailable);}chunks.push(value);}
    const parsed=responseSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    if(!parsed.success)throw new AppError(503,unavailable);
    const route=parsed.data.routes[0],points=route.legs[0].points;
    const meters=(x:MapPoint,y:MapPoint)=>Math.hypot((x.latitude-y.latitude)*111000,(x.longitude-y.longitude)*81000);
    if(meters(points[0],a)>500||meters(points.at(-1)!,b)>500)throw new AppError(503,unavailable);
    return {distanceM:route.summary.lengthInMeters,durationS:route.summary.travelTimeInSeconds,provider:'TOMTOM_V1',measuredAt,
      paths:[points.map(p=>[p.latitude,p.longitude])]};
  }catch(error){if(error instanceof AppError)throw error;throw new AppError(503,unavailable);}
}
