import {freshCourierPosition} from './courier-readiness';
import {notBlocked} from './trust-core';

// Arguments are internal column names only. Coordinates and filters never
// interpolate request strings into SQL; null endpoints remain unknown.
const distanceSql=(a:string,b:string,c:string,d:string)=>`CASE WHEN ${a} IS NULL OR ${b} IS NULL OR ${c} IS NULL OR ${d} IS NULL THEN NULL ELSE
  12742000*asin(least(1,sqrt(power(sin(radians(${c}-${a})/2),2)+cos(radians(${a}))*cos(radians(${c}))*power(sin(radians(${d}-${b})/2),2)))) END`;

export function courierQueueQuery(baseSelect:string,carEligibility:string,visibility:string) {
  const priority=`CASE WHEN o.courier_id=$1 AND o.status IN ('ACCEPTED','PICKED_UP','IN_TRANSIT') THEN 0
    WHEN o.courier_id=$1 THEN 5 WHEN o.deliver_after<=now() AND o.deliver_before>now() THEN 1
    WHEN o.deliver_after IS NULL THEN 2 WHEN o.deliver_before>now() THEN 3 ELSE 4 END`;
  const sort=`${priority},CASE WHEN o.deliver_after IS NULL AND o.courier_id IS NULL AND o.urgent THEN 0 ELSE 1 END,
    CASE WHEN o.deliver_after IS NOT NULL THEN CASE WHEN o.deliver_after>now() THEN o.deliver_after ELSE coalesce(o.deliver_before,o.created_at) END END,
    queue_rank.pickup_distance_m ASC NULLS LAST,
    CASE WHEN o.deliver_after IS NULL THEN o.created_at END DESC,
    CASE WHEN o.courier_id=$1 THEN o.created_at END DESC,o.id`;
  return `WITH origin AS MATERIALIZED (
    SELECT p.latitude,p.longitude,coalesce(${freshCourierPosition()},false) AS fresh,
      (SELECT a.transport FROM qadam.courier_applications a WHERE a.user_id=u.id AND a.status='APPROVED'
        ORDER BY a.reviewed_at DESC NULLS LAST,a.submitted_at DESC,a.id LIMIT 1) AS transport
    FROM qadam.users u LEFT JOIN qadam.courier_status s ON s.user_id=u.id
      LEFT JOIN qadam.courier_presence p ON p.user_id=u.id WHERE u.id=$1
  ), distances AS MATERIALIZED (
    SELECT o.id,CASE WHEN o.courier_id IS NULL AND origin.fresh THEN ${distanceSql('origin.latitude','origin.longitude','o.pickup_latitude','o.pickup_longitude')} END AS pickup_distance_m,
      ${distanceSql('o.pickup_latitude','o.pickup_longitude','o.destination_latitude','o.destination_longitude')} AS delivery_distance_m
    FROM qadam.orders o CROSS JOIN origin WHERE ${visibility}
  ), ranked AS MATERIALIZED (
    SELECT distances.* FROM distances JOIN qadam.orders o ON o.id=distances.id CROSS JOIN origin
    WHERE o.courier_id=$1 OR NOT $2::boolean OR origin.transport IS DISTINCT FROM 'FOOT'
      OR distances.delivery_distance_m IS NULL OR distances.delivery_distance_m<=4000
  ), visible AS (
    (SELECT o.id FROM qadam.orders o JOIN ranked queue_rank ON queue_rank.id=o.id WHERE o.courier_id=$1
      ORDER BY CASE WHEN o.status IN ('ACCEPTED','PICKED_UP','IN_TRANSIT') THEN 0 ELSE 1 END,o.created_at DESC,o.id LIMIT 100)
    UNION ALL
    (SELECT o.id FROM qadam.orders o JOIN ranked queue_rank ON queue_rank.id=o.id WHERE o.courier_id IS NULL AND o.status='SEARCHING_FOR_COURIER'
      AND o.deliver_after IS NULL AND (o.pickup_latitude IS NULL OR o.destination_latitude IS NULL) AND (o.price_kzt IS NULL OR ${carEligibility})
      ORDER BY o.urgent DESC,o.created_at DESC,o.id LIMIT 100)
    UNION ALL
    (SELECT o.id FROM qadam.orders o JOIN ranked queue_rank ON queue_rank.id=o.id WHERE o.courier_id IS NULL AND o.status='SEARCHING_FOR_COURIER'
      AND o.deliver_after IS NULL AND (o.price_kzt IS NULL OR ${carEligibility})
      ORDER BY o.urgent DESC,queue_rank.pickup_distance_m ASC NULLS LAST,o.created_at DESC,o.id LIMIT 100)
    UNION ALL
    (SELECT o.id FROM qadam.orders o JOIN ranked queue_rank ON queue_rank.id=o.id WHERE o.courier_id IS NULL AND o.status='SEARCHING_FOR_COURIER'
      AND o.deliver_after IS NOT NULL AND (o.price_kzt IS NULL OR ${carEligibility}) ORDER BY ${sort} LIMIT 100)
  ) ${baseSelect.replace('SELECT ','SELECT queue_rank.pickup_distance_m AS "pickupDistanceM",queue_rank.delivery_distance_m AS "deliveryDistanceM",')}
    JOIN ranked queue_rank ON queue_rank.id=o.id WHERE o.id IN (SELECT id FROM visible)
    AND EXISTS(SELECT 1 FROM qadam.users u WHERE u.id=$1 AND u.active AND ${notBlocked()}) ORDER BY ${sort}`;
}
