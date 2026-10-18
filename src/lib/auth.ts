import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { database } from './db';
import { AppError } from './errors';
import type { User } from './types';

const scrypt = promisify(scryptCallback);
export const sessionCookie = 'qadam_session';
export const sessionMaxAge = 60 * 60 * 24 * 7;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

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
  const result = await db.query('SELECT id,email,name,role,password_hash FROM qadam.users WHERE email=$1 AND active=true', [email]);
  const row = result.rows[0];
  // Do the expensive work for unknown users too.
  const fallbackHash = 'scrypt:00000000000000000000000000000000:' + '00'.repeat(64);
  const valid = await verifyPassword(password, row?.password_hash ?? fallbackHash);
  if (!row || !valid) throw new AppError(401, 'Неверный логин или пароль.');
  const user: User = { id: row.id, email: row.email, name: row.name, role: row.role };
  const token = randomBytes(32).toString('hex');
  await db.query('INSERT INTO qadam.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+$3 * interval \'1 second\')', [hashToken(token), user.id, sessionMaxAge]);
  await db.query('DELETE FROM qadam.login_attempts WHERE email=$1', [email]);
  await db.query('DELETE FROM qadam.sessions WHERE expires_at < now()');
  return { user, token };
}

export async function getSession(token: string | undefined): Promise<User | null> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const result = await database().query(`SELECT u.id,u.email,u.name,u.role FROM qadam.sessions s
    JOIN qadam.users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true`, [hashToken(token)]);
  return result.rows[0] ?? null;
}

export async function logout(token: string | undefined) {
  if (token) await database().query('DELETE FROM qadam.sessions WHERE token_hash=$1', [hashToken(token)]);
}
