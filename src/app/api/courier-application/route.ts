import { applicationSchema, ownApplication, submitApplication } from '../../../lib/courier-applications';
import { checkMutation, handle, json, readJson, requireUser } from '../../../lib/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return handle(async () => json({ application: await ownApplication(await requireUser(request)) }));
}
export async function POST(request: Request) {
  return handle(async () => {
    checkMutation(request); const actor = await requireUser(request);
    const input = applicationSchema.safeParse(await readJson(request));
    if (!input.success) return json({ error: 'Проверьте телефон, способ доставки и комментарий до 500 символов.' }, 400);
    return json({ application: await submitApplication(actor, input.data) }, 201);
  });
}
