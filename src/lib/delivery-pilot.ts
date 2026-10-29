import type { MapPoint } from './types';

// Scope approved by the owner on 29.10.2026. Monetary rates live in server settings.
export const deliveryPilot = {
  termsVersion: 'car-pilot-2026-10-29-v1',
  maxDistanceM: 15000,
  maxDurationS: 3600,
  maxQuoteSeconds: 120,
  zone: { south: 43.18, north: 43.31, west: 76.80, east: 77.05 },
  parcelStatement: 'Подтверждаю: обычная упакованная посылка до 5 кг, каждая сторона до 40 см.',
} as const;

export function insideDeliveryPilot(point: MapPoint) {
  const zone = deliveryPilot.zone;
  return point.latitude >= zone.south && point.latitude <= zone.north
    && point.longitude >= zone.west && point.longitude <= zone.east;
}
