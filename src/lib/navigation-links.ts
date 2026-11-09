import type {MapPoint,Order} from './types';
import {validPoint} from './geo-distance';

type Destination = {point:MapPoint|null;address:string};
export type NavigationLink={name:'2ГИС'|'Яндекс Карты'|'Google Maps';href:string};
export function navigationTarget(order:Order,courier:boolean):{label:string;target:Destination;origin:Destination|null} {
  if(courier&&['ACCEPTED','PICKED_UP','IN_TRANSIT'].includes(order.status)){
    const pickup=order.status==='ACCEPTED';
    return {label:pickup?'До отправителя':'До получателя',target:{point:pickup?order.pickupPoint:order.destinationPoint,address:pickup?order.pickupAddress:order.destinationAddress},origin:null};
  }
  return {label:'От отправителя к получателю',target:{point:order.destinationPoint,address:order.destinationAddress},origin:{point:order.pickupPoint,address:order.pickupAddress}};
}
export function navigationLinks(target:Destination,origin:Destination|null,walking=false):NavigationLink[] {
  const coordinate=(point:MapPoint)=>`${point.latitude},${point.longitude}`;
  const value=(destination:Destination)=>validPoint(destination.point)?coordinate(destination.point):destination.address;
  const links:NavigationLink[]=[];
  if(validPoint(target.point)){
    const a=validPoint(origin?.point)?`${origin.point.longitude},${origin.point.latitude}`:'';
    links.push({name:'2ГИС',href:`https://2gis.kz/almaty/directions/tab/${walking?'pedestrian':'car'}/points/${a}|${target.point.longitude},${target.point.latitude}`});
  }
  const yandex=new URL('https://yandex.kz/maps/');yandex.search=new URLSearchParams({rtext:`${origin?value(origin):''}~${value(target)}`,rtt:walking?'pd':'auto'}).toString();
  const google=new URL('https://www.google.com/maps/dir/');google.search=new URLSearchParams({api:'1',destination:value(target),travelmode:walking?'walking':'driving',...(origin?{origin:value(origin)}:{})}).toString();
  links.push({name:'Яндекс Карты',href:yandex.href},{name:'Google Maps',href:google.href});return links;
}
