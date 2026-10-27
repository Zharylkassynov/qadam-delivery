// Share the existing handler; do not duplicate delivery or authorization rules.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export { GET } from '../../../../src/app/api/session/route';
