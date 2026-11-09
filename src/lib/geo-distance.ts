import type { CourierLocation, MapPoint } from './types';

export function validPoint(point: MapPoint | null | undefined): point is MapPoint {
  return !!point&&Number.isFinite(point.latitude)&&Number.isFinite(point.longitude)&&Math.abs(point.latitude)<=90&&Math.abs(point.longitude)<=180;
}
export function distanceBetween(a: MapPoint | null | undefined,b: MapPoint | null | undefined): number | null {
  if(!validPoint(a)||!validPoint(b))return null;
  const rad=Math.PI/180,h=Math.sin((b.latitude-a.latitude)*rad/2)**2+Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin((b.longitude-a.longitude)*rad/2)**2;
  return 6371000*2*Math.asin(Math.min(1,Math.sqrt(h)));
}
export function freshLocation(location: CourierLocation | null | undefined,now=Date.now()): location is CourierLocation {
  return validPoint(location)&&!location.sharingStopped&&Number.isFinite(Date.parse(location.capturedAt))&&Number.isFinite(Date.parse(location.receivedAt))
    &&now-Date.parse(location.capturedAt)<90000&&now-Date.parse(location.receivedAt)<90000&&Date.parse(location.capturedAt)<=now+30000&&Date.parse(location.receivedAt)<=now+30000;
}
export const formatDistance=(metres:number)=>metres<1000?`${Math.round(metres)} м`:`${(metres/1000).toLocaleString('ru-KZ',{maximumFractionDigits:1})} км`;
