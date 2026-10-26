import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
})

/**
 * End the session in this browser only.
 * The default sign-out revokes every device on the same account, which leaves
 * other warehouse stations sending a token Supabase has already deleted.
 * An administrator force-logout still signs every station out on the server.
 */
export function signOutThisBrowser() {
  return supabase.auth.signOut({ scope: 'local' })
}

