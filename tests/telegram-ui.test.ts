import {test} from 'node:test';
import assert from 'node:assert/strict';
import {contrast,telegramPalette,validThemeColor} from '../src/lib/telegram-theme';
import {distanceBetween,freshLocation} from '../src/lib/geo-distance';
import {navigationLinks,navigationTarget} from '../src/lib/navigation-links';
import type {Order} from '../src/lib/types';

const point={latitude:43.24,longitude:76.9};
const order={id:'private-id',number:'123',status:'ACCEPTED',pickupAddress:'Абая, 10',destinationAddress:'Сатпаева, 30',pickupPoint:point,destinationPoint:{latitude:43.25,longitude:76.91}} as Order;
test('light, dark and malicious custom themes retain readable text and main action contrast',()=>{
  for(const dark of [false,true])for(const params of [{},{bg_color:'#123456',text_color:'#123456',hint_color:'#123456',button_color:'#123456',link_color:'#123456',button_text_color:'#123456'},
    {bg_color:'url(https://evil.invalid)',secondary_bg_color:'red;display:none',link_color:'var(--secret)',text_color:'#fff'}]){
    const palette=telegramPalette(dark,params);
    for(const value of Object.values(palette))assert.equal(validThemeColor(value),true);
    assert.ok(contrast(palette.ink,palette.surface)>=4.5);
    assert.ok(contrast(palette.muted,palette.surface)>=4.5);
    assert.ok(contrast(palette['button-text'],palette.action)>=4.5);
    assert.ok(contrast(palette.ink,palette.canvas)>=4.5);
  }
});
test('navigation chooses sender before pickup and recipient after pickup without changing history route',()=>{
  assert.equal(navigationTarget(order,true).target.address,order.pickupAddress);
  for(const status of ['PICKED_UP','IN_TRANSIT'] as const)assert.equal(navigationTarget({...order,status},true).target.address,order.destinationAddress);
  const history=navigationTarget({...order,status:'DELIVERED'},true);
  assert.equal(history.origin?.address,order.pickupAddress);assert.equal(history.target.address,order.destinationAddress);
  assert.equal(navigationTarget(order,false).origin?.address,order.pickupAddress);
});
test('navigation URLs preserve each coordinate order and walking mode without private order data',()=>{
  const links=navigationLinks({point:order.destinationPoint,address:order.destinationAddress},{point,address:order.pickupAddress},true);
  assert.equal(links.length,3);
  assert.match(links[0].href,/2gis.kz\/almaty\/directions\/tab\/pedestrian\/points\/76.9,43.24\|76.91,43.25$/);
  const yandex=new URL(links[1].href),google=new URL(links[2].href);
  assert.equal(yandex.searchParams.get('rtext'),'43.24,76.9~43.25,76.91');assert.equal(yandex.searchParams.get('rtt'),'pd');
  assert.equal(google.searchParams.get('api'),'1');assert.equal(google.searchParams.get('origin'),'43.24,76.9');assert.equal(google.searchParams.get('travelmode'),'walking');
  assert.equal(JSON.stringify(links).includes(order.id),false);
});
test('missing points omit 2GIS, encode text safely and leave current location to the navigator',()=>{
  const address='Алматы, Абая 10 & api=wrong # вход';
  const links=navigationLinks({point:null,address},null);
  assert.equal(links.length,2);assert.equal(links.some(link=>link.name==='2ГИС'),false);
  const google=new URL(links[1].href);
  assert.equal(google.searchParams.has('origin'),false);assert.equal(google.searchParams.get('api'),'1');assert.equal(google.searchParams.get('destination'),address);
  assert.equal(new URL(links[0].href).searchParams.get('rtext'),`~${address}`);
});
test('approximate distances and fresh origin checks never turn missing or stale coordinates into a current position',()=>{
  assert.equal(distanceBetween(point,point),0);assert.equal(distanceBetween(null,point),null);assert.equal(distanceBetween({...point,latitude:NaN},point),null);
  assert.ok(distanceBetween(point,{...point,latitude:43.25})!>1000);
  const now=Date.now(),location={...point,accuracy:20,capturedAt:new Date(now).toISOString(),receivedAt:new Date(now).toISOString()};
  assert.equal(freshLocation(location,now),true);
  assert.equal(freshLocation({...location,capturedAt:new Date(now-90001).toISOString()},now),false);
  assert.equal(freshLocation({...location,receivedAt:new Date(now-90001).toISOString()},now),false);
  assert.equal(freshLocation({...location,sharingStopped:true},now),false);
});
