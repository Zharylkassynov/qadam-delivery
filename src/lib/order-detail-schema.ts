import { z } from 'zod';
import { parcelKinds } from './order-details';
// Keep server validation out of the browser's formatting/date utilities.
const date=z.iso.datetime({offset:true}).transform(value=>new Date(value).toISOString()).nullable().optional();
export const orderDetailFields={
  parcelType:z.enum(parcelKinds).nullable().optional(),
  fragile:z.boolean().optional(),surprise:z.boolean().optional(),urgent:z.boolean().optional(),
  cardText:z.string().trim().max(300).nullable().optional(),
  businessName:z.string().trim().min(2).max(100).nullable().optional(),
  pickupDetails:z.string().trim().max(200).nullable().optional(),
  deliverAfter:date,deliverBefore:date,
};
