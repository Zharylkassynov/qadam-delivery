import { reverseAddress, reverseAddressSchema } from '../../../../lib/geocoding';
import { checkMutation, handle, json, readJson, requireUser } from '../../../../lib/http';
import { AppError } from '../../../../lib/errors';

export const runtime = 'nodejs';
export async function POST(request: Request) {
  return handle(async () => {
    checkMutation(request);
    const actor = await requireUser(request);
    const parsed = reverseAddressSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new AppError(400, 'Выберите точку в Алматы или окрестностях.');
    return json({ result: await reverseAddress(actor, parsed.data) });
  });
}
