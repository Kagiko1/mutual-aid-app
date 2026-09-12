import { createServerClient } from '@supabase/ssr';
import { createClient as createJsClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

/** Server-component / route-handler client (respects RLS via user session). */
export function createClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            /* called from a Server Component — cookies are read-only there */
          }
        },
      },
    },
  );
}

/**
 * Service-role client — bypasses RLS. Use ONLY in trusted server code.
 *
 * IMPORTANT: this client must never read the request's session cookies.
 * createServerClient attaches the user's JWT as the Authorization header,
 * and PostgREST then executes as the *user* (RLS applies) instead of as
 * service_role — silently downgrading every "admin" write. The plain client
 * below sends no user session, so the service_role key governs.
 */
export function createAdminClient() {
  return createJsClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
