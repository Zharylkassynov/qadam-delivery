import { locationSchema, reportLocation } from '../../../../../lib/locations';
import { checkMutation, handle, json, readJson, requireUser } from '../../../../../lib/http';
import { AppError } from '../../../../../lib/errors';

export const runtime = 'nodejs';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    checkMutation(request);
    const actor = await requireUser(request);
    const parsed = locationSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new AppError(400, 'Некорректные координаты, точность или время измерения.');
    return json({ location: await reportLocation(actor, (await context.params).id, parsed.data) });
  });
}
