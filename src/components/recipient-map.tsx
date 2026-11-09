'use client';
import {useEffect,useRef,useState} from 'react';
import type * as Leaflet from 'leaflet';
import type {CourierLocation} from '../lib/types';
import {sessionTileLayer} from '../lib/map-tile-layer';
import {Button,Feedback} from './delivery-ui';

export function RecipientMap({token,location}:{token:string;location:CourierLocation}){
  const element=useRef<HTMLDivElement>(null),map=useRef<Leaflet.Map|null>(null),marker=useRef<Leaflet.Marker|null>(null);
  const latest=useRef(location);latest.current=location;
  const [error,setError]=useState(false),[attempt,setAttempt]=useState(0),[ready,setReady]=useState(false);
  useEffect(()=>{
    let disposed=false;let observer:ResizeObserver|undefined;
    setError(false);setReady(false);
    void import('leaflet').then(L=>{
      if(disposed||!element.current)return;
      const point:[number,number]=[latest.current.latitude,latest.current.longitude];
      const view=L.map(element.current,{zoomControl:false,scrollWheelZoom:false,dragging:false,keyboard:false,doubleClickZoom:false,boxZoom:false,touchZoom:false,zoomAnimation:false,fadeAnimation:false,markerZoomAnimation:false}).setView(point,15);
      map.current=view;view.attributionControl.setPrefix(false);
      const tiles=sessionTileLayer(L,'/api/recipient-tiles/{z}/{x}/{y}',{minZoom:15,maxZoom:15,referrerPolicy:'no-referrer',attribution:'Powered by <a href="https://www.geoapify.com/" target="_blank" rel="noopener noreferrer">Geoapify</a> | © <a href="https://openmaptiles.org/" target="_blank" rel="noopener noreferrer">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'},{'X-Qadam-Tracking':token});
      tiles.on('tileerror',()=>{if(!disposed)setError(true);});tiles.addTo(view);
      marker.current=L.marker(point,{title:'Последняя позиция курьера',alt:'Последняя позиция курьера',icon:L.divIcon({className:'qadam-map-marker courier',html:'<img src="/icons/person.svg" width="24" height="24" alt=""/>',iconSize:[44,44],iconAnchor:[22,22]})}).addTo(view);
      observer=new ResizeObserver(()=>view.invalidateSize({animate:false,pan:false}));observer.observe(element.current);setReady(true);
    }).catch(()=>{if(!disposed)setError(true);});
    return()=>{disposed=true;observer?.disconnect();map.current?.remove();map.current=null;marker.current=null;};
  },[token,attempt]);
  useEffect(()=>{const p:[number,number]=[location.latitude,location.longitude];marker.current?.setLatLng(p);map.current?.setView(p,15,{animate:false});},[location.latitude,location.longitude]);
  return <div className="recipient-map"><div ref={element} role="region" aria-label="Последняя позиция курьера на карте" className="delivery-map" hidden={error}/>{!ready&&!error&&<p role="status">Загружаем карту…</p>}{error&&<Feedback title="Карта недоступна" tone="warning"><p>Статус доставки доступен. Попробуйте загрузить карту ещё раз.</p><Button variant="secondary" onClick={()=>setAttempt(n=>n+1)}>Повторить карту</Button></Feedback>}</div>;
}
