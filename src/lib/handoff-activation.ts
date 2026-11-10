import {database,transaction} from './db';
import {handoffsEnabled} from './handoff-settings';

let activated=false;
export async function ensureHandoffEnforcement(){
  if(!handoffsEnabled()||activated)return;
  if((await database().query('SELECT activated_at FROM qadam.handoff_enforcement WHERE singleton')).rows[0]?.activated_at){activated=true;return;}
  await transaction(async db=>{
    // Serialize first requests without depending on UPDATE RLS visibility after
    // another instance has activated the row while this request was waiting.
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended('handoff-activation',0))");
    const state=(await db.query('SELECT activated_at FROM qadam.handoff_enforcement WHERE singleton')).rows[0];
    if(!state)throw new Error('Handoff migration is required');
    if(state.activated_at)return;
    // No order/courier row is held before this table lock. Old requests finish
    // first; all custody snapshots and activation then commit together.
    await db.query('LOCK TABLE qadam.orders IN EXCLUSIVE MODE');
    await db.query(`WITH enrolled AS (
      UPDATE qadam.orders SET custody_assignment_version=assignment_version,custody_at=coalesce(custody_at,clock_timestamp()),status='IN_TRANSIT'
      WHERE status IN ('PICKED_UP','IN_TRANSIT') AND (custody_assignment_version IS DISTINCT FROM assignment_version OR status='PICKED_UP')
      RETURNING id,customer_id,status)
      INSERT INTO qadam.order_events(order_id,actor_id,status,kind,reason)
      SELECT id,customer_id,status,'SAFETY_ENROLLED','Заказ уже в пути при обновлении. Забор задним числом не подтверждён; вручение требует проверки.' FROM enrolled`);
    await db.query('UPDATE qadam.handoff_enforcement SET activated_at=clock_timestamp() WHERE singleton AND activated_at IS NULL');
  });
  activated=true;
}
