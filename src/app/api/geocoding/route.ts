import { addressSearchSchema, searchAddresses } from '../../../lib/geocoding';
import { checkMutation, handle, json, readJson, requireUser } from '../../../lib/http';
import { AppError } from '../../../lib/errors';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  return handle(async () => {
    checkMutation(request);
    const actor = await requireUser(request);
    const parsed = addressSearchSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new AppError(400, 'Укажите улицу и дом: от 5 до 200 символов.');
    return json({ results: await searchAddresses(actor, parsed.data) });
  });
}
