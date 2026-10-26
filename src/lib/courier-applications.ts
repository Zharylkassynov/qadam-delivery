import { z } from 'zod';
import type { PoolClient } from 'pg';
import { database, transaction } from './db';
import { AppError } from './errors';
import { requireAdministrator } from './administrators';
import { courierTransports, type CourierApplication, type User } from './types';
import { availabilityOptions, districts } from './courier-options';
import { queueApplicationDecision, queueApplicationSubmitted } from './telegram-notifications';

export const applicationSchema = z.object({
  phone: z.string().trim().min(7).max(30).regex(/^[+\d\s()\-]+$/).refine((s) => s.replace(/\D/g, '').length >= 7),
  transport: z.enum(courierTransports), notes: z.string().trim().max(500).default(''),
  district: z.enum(districts), availability: z.array(z.enum(availabilityOptions)).min(1).max(4).refine(a => new Set(a).size === a.length),
  ageConfirmed: z.literal(true), acceptRules: z.literal(true), source: z.string().regex(/^[a-z0-9_]{1,64}$/).optional(),
}).strict();
export const decisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']), reason: z.string().trim().max(500).default(''),
}).strict().refine((s) => s.decision !== 'REJECTED' || s.reason.length >= 5);
type Input = z.infer<typeof applicationSchema>;
type Decision = z.infer<typeof decisionSchema>;
const fields = `a.id,a.user_id AS "userId",u.name,t.telegram_user_id::text AS "telegramId",a.phone,a.transport,a.notes,a.status,
  a.submitted_at AS "submittedAt",a.reviewed_at AS "reviewedAt",r.name AS reviewer,a.decision_reason AS "decisionReason",u.active AS "applicantActive",
  a.district,a.availability,a.age_confirmed AS "ageConfirmed",a.consent_at AS "consentAt",a.source`;
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
      if (application.phone !== data.phone || application.transport !== data.transport || application.notes !== data.notes ||
        application.district !== data.district || JSON.stringify(application.availability) !== JSON.stringify(data.availability)) throw new AppError(409, 'Заявка уже на рассмотрении. Дождитесь решения администратора.');
      return application;
    }
    const result = await db.query(`INSERT INTO qadam.courier_applications(user_id,phone,transport,notes,district,availability,age_confirmed,consent_at,source)
      VALUES($1,$2,$3,$4,$5,$6,true,now(),coalesce((SELECT source FROM qadam.telegram_identities WHERE user_id=$1),$7)) RETURNING id`,
    [actor.id, data.phone, data.transport, data.notes, data.district, data.availability, data.source ?? null]);
    const saved = await read(db, result.rows[0].id);
    await queueApplicationSubmitted(db, saved);
    return saved;
  });
}
export async function listApplications(actor: User): Promise<CourierApplication[]> {
  const db = database(); await requireAdministrator(db, actor);
  return (await db.query(`SELECT ${fields} ${from} ORDER BY (a.status='PENDING') DESC,a.submitted_at DESC,a.id DESC LIMIT 100`)).rows;
}
export async function reviewApplication(actor: User, id: string, input: Decision) {
  input = decisionSchema.parse(input);
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
    const saved = await read(db, id);
    await queueApplicationDecision(db, saved);
    return saved;
  });
}

export async function listCouriers(actor: User): Promise<CourierApplication[]> {
  const db = database(); await requireAdministrator(db, actor);
  return (await db.query(`SELECT ${fields} ${from} WHERE a.status='APPROVED' AND u.active ORDER BY a.reviewed_at DESC,a.id DESC LIMIT 300`)).rows;
}
