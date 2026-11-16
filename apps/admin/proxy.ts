import { NextResponse, type NextRequest } from 'next/server';

import { forbiddenResponse } from '@/lib/auth/forbidden-response';
import {
  adminCookieOptions,
  adminSessionOperation,
  createAdminProvider,
  isAdminCookie,
} from '@/lib/auth/provider';

import type { SetAllCookies } from '@supabase/ssr';

export async function proxy(request: NextRequest) {
  // Each Server Action performs its own server-side check. Handle navigation
  // here so denials have a status before any page or RSC bytes are streamed.
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return NextResponse.next();

  const hasCookie = request.cookies
    .getAll()
    .some(({ name }) => isAdminCookie(name));
  const changes: Parameters<SetAllCookies>[0] = [];
  let response: NextResponse;

  if (!hasCookie) {
    response = NextResponse.redirect(new URL('/login', request.url), 302);
  } else {
    try {
      const provider = createAdminProvider({
        getAll: () => request.cookies.getAll(),
        setAll(values) {
          for (const cookie of values)
            request.cookies.set(cookie.name, cookie.value);
          changes.push(...values);
        },
      });
      const session = await adminSessionOperation(provider, 'check');
      if (session.status === 'active') {
        response = NextResponse.next({ request });
      } else if (session.status === 'forbidden') {
        response = forbiddenResponse();
      } else {
        response = NextResponse.redirect(
          new URL('/login?reason=expired', request.url),
          302,
        );
        for (const { name } of request.cookies
          .getAll()
          .filter(({ name }) => isAdminCookie(name))) {
          changes.push({
            name,
            value: '',
            options: { ...adminCookieOptions, maxAge: 0 },
          });
        }
      }
    } catch {
      response = new NextResponse(
        'Admin access is temporarily unavailable. Try again.',
        { status: 503 },
      );
    }
  }

  for (const { name, value, options } of changes)
    response.cookies.set(name, value, options);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export const config = {
  matcher: ['/((?!login(?:/|$)|forbidden(?:/|$)|_next/|favicon.ico).*)'],
};
