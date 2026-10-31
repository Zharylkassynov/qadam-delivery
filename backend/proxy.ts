import { NextResponse, type NextRequest } from 'next/server';
import { allowedAppOrigins } from '../src/lib/app-origins';

export function proxy(request: NextRequest) {
  const origin = request.headers.get('origin');
  const allowed = origin !== null && allowedAppOrigins().has(origin);
  // CORS supplements the existing session/role checks in every API handler.
  if (origin !== null && !allowed) return NextResponse.json({ error: 'Недопустимый источник запроса.' }, { status: 403 });
  const preflight = request.method === 'OPTIONS';
  const methods=request.nextUrl.pathname==='/api/business-profile'?['GET','PUT','DELETE','HEAD']:['GET','POST','HEAD'];
  if (preflight) {
    const method = request.headers.get('access-control-request-method');
    const headers = (request.headers.get('access-control-request-headers') ?? '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
    if (!allowed || !methods.includes(method ?? '') || headers.some(header => !['content-type', 'authorization'].includes(header))) {
      return NextResponse.json({ error: 'Недопустимый предварительный запрос.' }, { status: 403 });
    }
  }
  const response = preflight ? new NextResponse(null, { status: 204 }) : NextResponse.next();
  if (allowed) {
    response.headers.set('Access-Control-Allow-Origin', origin!);
    response.headers.set('Access-Control-Allow-Credentials', 'true');
    if (preflight) {
      response.headers.set('Access-Control-Allow-Methods', [...methods,'OPTIONS'].join(', '));
      response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      response.headers.set('Access-Control-Max-Age', '600');
    }
  }
  response.headers.set('Vary', 'Origin, Cookie, Authorization');
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export const config = { matcher: '/api/:path*' };
