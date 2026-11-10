// Historical suites exercise pre-handoff business rules in an isolated database.
// The new handoff suite explicitly enables and tests mandatory verification.
const url=process.env.TEST_DATABASE_URL;
if(!url||!['localhost','127.0.0.1'].includes(new URL(url).hostname)||!new URL(url).pathname.endsWith('_test'))throw new Error('Separate local test database required');
process.env.APP_ORIGIN='http://127.0.0.1:3100';
process.env.DELIVERY_HANDOFFS_ENABLED='false';
