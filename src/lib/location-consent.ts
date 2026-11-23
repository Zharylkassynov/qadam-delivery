// Safe to import in the browser: contains no configuration or credentials.
export const locationConsentVersion='2026-11-10-v1';
export const courierLocationConsent='Разрешаю использовать мою геопозицию на карте во время смены и активных доставок. Согласие могу отозвать в любой момент.';
export type LocationStreamStatus={
  enabled:boolean;pilotOnly:boolean;allowed:boolean;
  stream:null|{id:string;state:'WAITING'|'LIVE'|'STOPPED';expiresAt:string;updatedAt:string|null;receivedAt:string|null;updateCount:number};
};
