import { hashPassword } from '../src/lib/auth';
import { closeDatabase, transaction } from '../src/lib/db';

export async function seed() {
  if (process.env.DEMO_AUTH_ENABLED !== 'true') throw new Error('Set DEMO_AUTH_ENABLED=true to seed demo accounts');
  const password = process.env.DEMO_PASSWORD;
  if (!password || password.length < 12) throw new Error('DEMO_PASSWORD must contain at least 12 characters');
  await transaction(async (client) => {
    for (const role of ['CUSTOMER', 'COURIER'] as const) {
      for (let i = 1; i <= 3; i++) {
        const email = `${role === 'CUSTOMER' ? 'customer' : 'courier'}${i}@qadam.demo`;
        const name = `${role === 'CUSTOMER' ? 'Клиент' : 'Курьер'} ${i}`;
        await client.query(`INSERT INTO qadam.users(email,name,role,password_hash) VALUES($1,$2,$3,$4)
          ON CONFLICT(email) DO UPDATE SET password_hash=EXCLUDED.password_hash
          WHERE qadam.users.role=EXCLUDED.role`, [email, name, role, await hashPassword(password)]);
      }
    }
  });
  console.log('Demo accounts ready: customer1..3@qadam.demo, courier1..3@qadam.demo. Password is DEMO_PASSWORD in .env.');
}

if (process.argv[1]?.endsWith('seed.ts')) {
  seed().catch((error) => { console.error(error instanceof Error ? error.message : 'Seed failed'); process.exitCode = 1; }).finally(closeDatabase);
}
