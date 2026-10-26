import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { database, transaction } from './db';
import { AppError } from './errors';
import type { User } from './types';
import { verifyTelegramData } from './telegram';

const scrypt = promisify(scryptCallback);
export const sessionCookie = 'qadam_session';
export const sessionMaxAge = 60 * 60 * 24 * 7;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
// Approved applications grant courier access without runtime UPDATE rights on users.
const userFields = `u.id,u.email,u.name,
  CASE WHEN u.role='COURIER' OR EXISTS(SELECT 1 FROM qadam.courier_applications ca WHERE ca.user_id=u.id AND ca.status='APPROVED')
    THEN 'COURIER' ELSE 'CUSTOMER' END AS role,
  t.telegram_user_id::text AS "telegramId",
  EXISTS(SELECT 1 FROM qadam.administrators a WHERE a.user_id=u.id) AS "isAdmin"`;
function publicUser(row: Record<string, unknown>): User {
  return { id: row.id as string, email: row.email as string, name: row.name as string, role: row.role as User['role'],
    ...(row.telegramId ? { telegramId: row.telegramId as string } : {}), ...(row.isAdmin ? { isAdmin: true as const } : {}) };
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64) as Buffer;
  return `scrypt:${salt}:${key.toString('hex')}`;
}

async function verifyPassword(password: string, stored: string) {
  const [algorithm, salt, hash] = stored.split(':');
  if (algorithm !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = await scrypt(password, salt, 64) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function login(email: string, password: string) {
  if (process.env.DEMO_AUTH_ENABLED !== 'true') throw new AppError(403, 'Демонстрационный вход отключён.');
  const db = database();
  const attempt = await db.query(`INSERT INTO qadam.login_attempts(email) VALUES($1)
    ON CONFLICT(email) DO UPDATE SET
      attempts=CASE WHEN qadam.login_attempts.window_start < now()-interval '15 minutes' THEN 1 ELSE qadam.login_attempts.attempts+1 END,
      window_start=CASE WHEN qadam.login_attempts.window_start < now()-interval '15 minutes' THEN now() ELSE qadam.login_attempts.window_start END
    RETURNING attempts`, [email]);
  if (attempt.rows[0].attempts > 15) throw new AppError(429, 'Слишком много попыток. Повторите через 15 минут.');
  const result = await db.query(`SELECT ${userFields},u.password_hash FROM qadam.users u LEFT JOIN qadam.telegram_identities t ON t.user_id=u.id WHERE u.email=$1 AND u.active=true`, [email]);
  const row = result.rows[0];
  // Do the expensive work for unknown users too.
  const fallbackHash = 'scrypt:00000000000000000000000000000000:' + '00'.repeat(64);
  const valid = await verifyPassword(password, row?.password_hash ?? fallbackHash);
  if (!row || !valid) throw new AppError(401, 'Неверный логин или пароль.');
  const user = publicUser(row);
  const token = randomBytes(32).toString('hex');
  await db.query('INSERT INTO qadam.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+$3 * interval \'1 second\')', [hashToken(token), user.id, sessionMaxAge]);
  await db.query('DELETE FROM qadam.login_attempts WHERE email=$1', [email]);
  await db.query('DELETE FROM qadam.sessions WHERE expires_at < now()');
  return { user, token };
}

export async function getSession(token: string | undefined): Promise<User | null> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const result = await database().query(`SELECT ${userFields} FROM qadam.sessions s
    JOIN qadam.users u ON u.id=s.user_id LEFT JOIN qadam.telegram_identities t ON t.user_id=u.id
    WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true`, [hashToken(token)]);
  const row = result.rows[0];
  if (!row) return null;
  return publicUser(row);
}

export async function loginTelegram(initData: string) {
  if (process.env.TELEGRAM_AUTH_ENABLED !== 'true') throw new AppError(403, 'Вход через Telegram пока не подключён.');
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken || !/^\d+:[A-Za-z0-9_-]{30,}$/.test(botToken)) throw new AppError(503, 'Вход через Telegram временно недоступен.');
  const identity = verifyTelegramData(initData, botToken);
  return transaction(async (client) => {
    // One identity even if Telegram retries the request concurrently.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('telegram:' || $1,0))", [identity.id]);
    const found = await client.query(`SELECT ${userFields},u.active FROM qadam.telegram_identities t
      JOIN qadam.users u ON u.id=t.user_id WHERE t.telegram_user_id=$1`, [identity.id]);
    let row = found.rows[0];
    if (row && !row.active) throw new AppError(403, 'Этот аккаунт отключён. Обратитесь к администратору.');
    if (!row) {
      // No usable password is issued; role and active use database defaults.
      const passwordHash = await hashPassword(randomBytes(32).toString('hex'));
      const created = await client.query(`INSERT INTO qadam.users(email,name,password_hash) VALUES($1,$2,$3)
        RETURNING id,email,name,role`, [`tg.${identity.id}@telegram.qadam.invalid`, identity.name, passwordHash]);
      row = created.rows[0];
      await client.query('INSERT INTO qadam.telegram_identities(telegram_user_id,user_id) VALUES($1,$2)', [identity.id, row.id]);
    }
    const user = publicUser({ ...row, telegramId: identity.id });
    await client.query(`UPDATE qadam.telegram_identities SET
      allows_write=$2 OR EXISTS(SELECT 1 FROM qadam.telegram_bot_chats c WHERE c.telegram_user_id=$1 AND c.allows_write AND c.bot_blocked_at IS NULL),
      bot_blocked_at=CASE WHEN $2 THEN NULL ELSE bot_blocked_at END,
      source=coalesce($3,source) WHERE telegram_user_id=$1`, [identity.id, identity.allowsWrite === true, identity.source ?? null]);
    const token = randomBytes(32).toString('hex');
    await client.query("INSERT INTO qadam.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+$3 * interval '1 second')", [hashToken(token), user.id, sessionMaxAge]);
    await client.query('DELETE FROM qadam.sessions WHERE expires_at < now()');
    return { user, token, source: identity.source, startScreen: identity.source?.startsWith('courier') ? 'courier' as const : undefined };
  });
}

export async function logout(token: string | undefined) {
  if (token) await database().query('DELETE FROM qadam.sessions WHERE token_hash=$1', [hashToken(token)]);
}
