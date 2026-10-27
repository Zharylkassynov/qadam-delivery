// Share the existing handler; do not duplicate delivery or authorization rules.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export { GET, POST } from '../../../../src/app/api/orders/route';
