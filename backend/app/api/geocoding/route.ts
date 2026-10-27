// Share the existing handler; do not duplicate delivery or authorization rules.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export { POST } from '../../../../src/app/api/geocoding/route';
