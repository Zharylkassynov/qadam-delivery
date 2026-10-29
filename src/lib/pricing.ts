import { z } from 'zod';

// No business rates/default tariff here. Activation is an explicit database operation.
export const tariffSchema = z.object({
  version: z.string().min(1).max(80),
  minimumKzt: z.number().int().min(0).max(100000),
  baseKzt: z.number().int().min(0).max(100000),
  perKmKzt: z.number().int().min(0).max(10000),
  perMinuteKzt: z.number().int().min(0).max(10000),
  roundToKzt: z.number().int().min(1).max(1000),
  ttlSeconds: z.number().int().min(30).max(300),
  provider: z.literal('TOMTOM_V1'),
  zone: z.object({ south: z.number().min(-90).max(90),north: z.number().min(-90).max(90),west: z.number().min(-180).max(180),east: z.number().min(-180).max(180) }).strict()
    .refine(v=>v.south<v.north&&v.west<v.east),
}).strict();
export type Tariff = z.infer<typeof tariffSchema>;
export type PriceBreakdown = { baseKzt: number; distanceKzt: number; timeKzt: number; minimumAdjustmentKzt: number; roundingKzt: number; totalKzt: number; platformFeeKzt: 0; courierPayoutKzt: number };

export function calculatePrice(input: Tariff, distanceM: number, durationS: number): PriceBreakdown {
  const tariff=tariffSchema.parse(input);
  if(!Number.isSafeInteger(distanceM)||distanceM<1||distanceM>100000||!Number.isSafeInteger(durationS)||durationS<1||durationS>14400)throw new Error('Invalid pricing metrics');
  // A common integer denominator (3000) represents both meters/1000 and seconds/60.
  // No floating point rounding can make a boundary charge another 50 tenge.
  const base=tariff.baseKzt*3000,distance=distanceM*tariff.perKmKzt*3,time=durationS*tariff.perMinuteKzt*50;
  const subtotal=base+distance+time,minimum=Math.max(subtotal,tariff.minimumKzt*3000);
  const totalKzt=Math.ceil(minimum/(tariff.roundToKzt*3000))*tariff.roundToKzt;
  const distanceKzt=Math.round(distance/30)/100,timeKzt=Math.round(time/30)/100;
  const minimumAdjustmentKzt=Math.max(0,tariff.minimumKzt-tariff.baseKzt-distanceKzt-timeKzt);
  return {baseKzt:tariff.baseKzt,distanceKzt,timeKzt,minimumAdjustmentKzt:Math.round(minimumAdjustmentKzt*100)/100,
    roundingKzt:Math.round((totalKzt-tariff.baseKzt-distanceKzt-timeKzt-minimumAdjustmentKzt)*100)/100,
    totalKzt,platformFeeKzt:0,courierPayoutKzt:totalKzt};
}
