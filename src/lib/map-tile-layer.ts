'use client';

import type * as Leaflet from 'leaflet';
import { sessionHeaders, sessionCredentials } from './client-api';
import { apiPath } from './api-origin';

// Bound requests per browser. Telegram Web can block cookies, so tiles use the
// same in-memory bearer session as order requests; provider keys stay server-side.
let active = 0;
const queue: (() => void)[] = [];
async function acquire() { if (active < 4) active++; else await new Promise<void>((resolve) => queue.push(resolve)); }
function release() { const next = queue.shift(); if (next) next(); else active--; }

export function sessionTileLayer(L: typeof Leaflet, url: string, options: Leaflet.TileLayerOptions) {
  const resources = new WeakMap<HTMLImageElement, { controller: AbortController; url?: string; removed: boolean }>();
  class SessionTiles extends L.TileLayer {
    createTile(coords: Leaflet.Coords, done: Leaflet.DoneCallback): HTMLElement {
      const image = document.createElement('img'); image.alt = ''; image.setAttribute('role', 'presentation');
      const resource = { controller: new AbortController(), removed: false, url: undefined as string | undefined }; resources.set(image, resource);
      void (async () => {
        await acquire();
        const timeout = setTimeout(() => resource.controller.abort(), 12000);
        try {
          if (resource.removed) return;
          const tile = this.getTileUrl(coords);
          const response = await fetch(tile.startsWith('/api/') ? apiPath(tile) : tile, { headers: sessionHeaders(), signal: resource.controller.signal, credentials: sessionCredentials() });
          if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error('Map tile unavailable');
          const blob = await response.blob(); if (resource.removed) return;
          resource.url = URL.createObjectURL(blob);
          image.onload = () => { if (!resource.removed) done(undefined, image); };
          image.onerror = () => { if (!resource.removed) done(new Error('Map image unavailable'), image); };
          image.src = resource.url;
        } catch { if (!resource.removed) done(new Error('Map tile unavailable'), image); }
        finally { clearTimeout(timeout); release(); }
      })();
      return image;
    }
  }
  const layer = new SessionTiles(url, options);
  layer.on('tileunload', (event: Leaflet.TileEvent) => {
    const image = event.tile as HTMLImageElement; const resource = resources.get(image);
    if (resource) { resource.removed = true; resource.controller.abort(); if (resource.url) URL.revokeObjectURL(resource.url); }
    image.onload = null; image.onerror = null;
  });
  return layer;
}
