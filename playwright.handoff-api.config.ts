import {defineConfig} from '@playwright/test';
import apiConfig from './playwright.api.config';
const servers=Array.isArray(apiConfig.webServer)?apiConfig.webServer:[];
export default defineConfig({...apiConfig,testDir:'./tests/handoff-api-e2e',outputDir:'test-results/handoff-api',webServer:[
  {...servers[0],env:{...servers[0].env,DELIVERY_HANDOFFS_ENABLED:'true',DELIVERY_CODE_SECRET:'cd'.repeat(32),DELIVERY_PROOF_ENABLED:'true',TELEGRAM_STORAGE_CHAT_ID:'-1001234567890',QADAM_PHOTO_TEST_PROVIDER:'true',NODE_OPTIONS:'--import=./tests/e2e/photo-provider-preload.mjs'}},servers[1],
]});
