// Safe to import in the browser: contains no configuration or credentials.
export const locationConsentVersion='2026-11-01-v1';
export type LocationStreamStatus={
  enabled:boolean;pilotOnly:boolean;allowed:boolean;
  stream:null|{id:string;state:'WAITING'|'LIVE'|'STOPPED';expiresAt:string;updatedAt:string|null;receivedAt:string|null;updateCount:number};
};
