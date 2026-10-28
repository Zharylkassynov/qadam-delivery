'use client';

import type { CourierLocation } from './types';

export type DeviceFix = Omit<CourierLocation, 'receivedAt'>;
export function nativeLocationManager() {
  const app=window.Telegram?.WebApp;
  return app?.initData && app.isVersionAtLeast?.('8.0') ? app.LocationManager : undefined;
}
export async function locationPermission(): Promise<'granted'|'prompt'|'denied'|'unavailable'> {
  const manager=nativeLocationManager();
  if(manager) {
    if(!manager.isInited) await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Геолокация не отвечает. Повторите запрос.')),15000);
      manager.init(()=>{clearTimeout(timer);resolve();});
    });
    return !manager.isLocationAvailable?'unavailable':manager.isAccessGranted?'granted':manager.isAccessRequested?'denied':'prompt';
  }
  if(!navigator.geolocation) return 'unavailable';
  try { return (await navigator.permissions.query({name:'geolocation'})).state; }
  catch { return 'prompt'; }
}
export async function currentLocation(): Promise<DeviceFix> {
  const app = window.Telegram?.WebApp;
  const manager = app?.initData && app.isVersionAtLeast?.('8.0') ? app.LocationManager : undefined;
  if (manager) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Не удалось получить позицию. Проверьте геолокацию устройства и повторите.')), 15000);
      const read = () => {
        if (!manager.isLocationAvailable) { clearTimeout(timer); reject(new Error('Геолокация недоступна на этом устройстве.')); return; }
        manager.getLocation((data) => {
          clearTimeout(timer);
          if (!data) { reject(new Error('Доступ к геолокации не предоставлен. Включите его в настройках Telegram.')); return; }
          resolve({ latitude: data.latitude, longitude: data.longitude, accuracy: data.horizontal_accuracy, capturedAt: new Date().toISOString() });
        });
      };
      if (manager.isInited) read(); else manager.init(read);
    });
  }
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('Геолокация не поддерживается. Откройте заказ в Telegram на телефоне.')); return; }
    navigator.geolocation.getCurrentPosition((position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy, capturedAt: new Date(position.timestamp).toISOString() }),
      (error) => reject(new Error(error.code === 1 ? 'Доступ к геолокации не предоставлен. Включите его в настройках браузера или Telegram.' : 'Не удалось получить позицию. Проверьте геолокацию устройства и повторите.')),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 });
  });
}
