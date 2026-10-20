import { z } from 'zod';
import type { PoolClient } from 'pg';
import { database, transaction } from './db';
import { AppError } from './errors';
import { courierTransports, type CourierApplication, type User } from './types';

export const applicationSchema = z.object({
  phone: z.string().trim().min(7).max(30).regex(/^[+\d\s()\-]+$/).refine((s) => s.replace(/\D/g, '').length >= 7),
  transport: z.enum(courierTransports), notes: z.string().trim().max(500).default(''),
}).strict();
export const decisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']), reason: z.string().trim().max(500).default(''),
}).strict().refine((s) => s.decision !== 'REJECTED' || s.reason.length >= 5);
type Input = z.infer<typeof applicationSchema>;
type Decision = z.infer<typeof decisionSchema>;
const fields = `a.id,a.user_id AS "userId",u.name,t.telegram_user_id::text AS "telegramId",a.phone,a.transport,a.notes,a.status,
  a.submitted_at AS "submittedAt",a.reviewed_at AS "reviewedAt",r.name AS reviewer,a.decision_reason AS "decisionReason",u.active AS "applicantActive"`;
const from = `FROM qadam.courier_applications a JOIN qadam.users u ON u.id=a.user_id
  JOIN qadam.telegram_identities t ON t.user_id=u.id LEFT JOIN qadam.users r ON r.id=a.reviewed_by`;
type Queryable = Pick<PoolClient, 'query'>;
async function read(db: Queryable, id: string): Promise<CourierApplication> {
  const result = await db.query(`SELECT ${fields} ${from} WHERE a.id=$1`, [id]);
  if (!result.rows[0]) throw new AppError(404, 'Заявка не найдена.');
  return result.rows[0];
}
function requireTelegram(actor: User) {
  if (!actor.telegramId) throw new AppError(403, 'Подать заявку можно из Telegram Mini App.');
}
async function requireAdministrator(db: Queryable, actor: User) {
  // Query the membership table; never trust a flag received from a caller.
  const result = await db.query(`SELECT 1 FROM qadam.administrators a JOIN qadam.users u ON u.id=a.user_id WHERE a.user_id=$1 AND u.active=true`, [actor.id]);
  if (!result.rowCount) throw new AppError(403, 'Этот раздел доступен только администратору.');
}
export async function ownApplication(actor: User): Promise<CourierApplication | null> {
  requireTelegram(actor);
  const result = await database().query(`SELECT ${fields} ${from} WHERE a.user_id=$1 ORDER BY a.submitted_at DESC,a.id DESC LIMIT 1`, [actor.id]);
  return result.rows[0] ?? null;
}
export async function submitApplication(actor: User, input: Input) {
  requireTelegram(actor);
  const data = applicationSchema.parse(input);
  return transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended('courier-submit:' || $1,0))", [actor.id]);
    const member = await db.query('SELECT role,active FROM qadam.users WHERE id=$1', [actor.id]);
    if (!member.rows[0]?.active) throw new AppError(403, 'Этот аккаунт отключён.');
    if (member.rows[0].role === 'COURIER') throw new AppError(409, 'У вас уже есть доступ курьера.');
    const existing = await db.query("SELECT id,status FROM qadam.courier_applications WHERE user_id=$1 AND status IN ('PENDING','APPROVED')", [actor.id]);
    if (existing.rows[0]) {
      const application = await read(db, existing.rows[0].id);
      if (application.status === 'APPROVED') throw new AppError(409, 'Заявка уже одобрена.');
      if (application.phone !== data.phone || application.transport !== data.transport || application.notes !== data.notes) throw new AppError(409, 'Заявка уже на рассмотрении. Дождитесь решения администратора.');
      return application;
    }
    const result = await db.query('INSERT INTO qadam.courier_applications(user_id,phone,transport,notes) VALUES($1,$2,$3,$4) RETURNING id', [actor.id, data.phone, data.transport, data.notes]);
    return read(db, result.rows[0].id);
  });
}
export async function listApplications(actor: User): Promise<CourierApplication[]> {
  const db = database(); await requireAdministrator(db, actor);
  return (await db.query(`SELECT ${fields} ${from} ORDER BY (a.status='PENDING') DESC,a.submitted_at DESC,a.id DESC LIMIT 100`)).rows;
}
export async function reviewApplication(actor: User, id: string, input: Decision) {
  return transaction(async (db) => {
    await requireAdministrator(db, actor);
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended('courier-review:' || $1,0))", [id]);
    const application = await read(db, id);
    const reason = input.decision === 'REJECTED' ? input.reason : '';
    if (application.status !== 'PENDING') {
      if (application.status === input.decision && application.decisionReason === reason) return application;
      throw new AppError(409, 'Заявка уже рассмотрена. Обновите список.');
    }
    if (!application.applicantActive) throw new AppError(409, 'Аккаунт заявителя отключён.');
    await db.query(`UPDATE qadam.courier_applications SET status=$1,decision_reason=$2,reviewed_at=now(),reviewed_by=$3 WHERE id=$4 AND status='PENDING'`, [input.decision, reason, actor.id, id]);
    return read(db, id);
  });
}
