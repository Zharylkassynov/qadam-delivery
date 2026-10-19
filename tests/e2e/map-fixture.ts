import type { BrowserContext } from '@playwright/test';

// Never make a browser test crawl a public map tile service.
export async function mockMapTiles(context: BrowserContext) {
  await context.route(/(?:https:\/\/tile\.openstreetmap\.org\/|\/api\/map-tiles\/)/, (route) => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e9f0f3"/><text x="20" y="125" fill="#526779" font-size="12">Тестовая карта · автотест</text></svg>',
  }));
}
