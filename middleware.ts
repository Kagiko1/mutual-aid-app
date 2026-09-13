/**
 * Auth middleware: refreshes Supabase session cookies on every request and
 * redirects unauthenticated users to /login for all non-public paths.
 *
 * Public: /, /login (incl. /login/forgot), /start (org create/join), /auth/* (email-link
 * callback + password reset), M-Pesa callbacks (called by Daraja without a session), the cron
 * endpoint (authenticates via CRON_SECRET itself), and the public auth/signup APIs.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const PUBLIC_PATHS = ['/', '/login', '/login/forgot', '/start', '/auth/callback', '/auth/reset-password'];
const PUBLIC_PREFIXES = ['/api/mpesa/callback', '/api/mpesa/b2c-callback', '/api/cron/', '/api/signup', '/api/auth/'];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublic(request.nextUrl.pathname)) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all paths except static assets, image optimization, and favicon.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
