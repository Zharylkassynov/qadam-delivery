import type { PoolClient } from 'pg';
import { AppError } from './errors';
import type { User } from './types';

export async function requireAdministrator(db: Pick<PoolClient, 'query'>, actor: User) {
  // Membership is private server data. A supplied isAdmin flag grants nothing.
  const result = await db.query(`SELECT 1 FROM qadam.administrators a
    JOIN qadam.users u ON u.id=a.user_id WHERE a.user_id=$1 AND u.active=true`, [actor.id]);
  if (!result.rowCount) throw new AppError(403, 'Этот раздел доступен только администратору.');
}
