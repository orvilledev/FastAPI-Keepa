import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { clearMfaActivity } from '../lib/mfa'
import { recordWebAuditEvent } from '../lib/auditEvents'
import { rememberLoginEmail } from '../lib/savedLoginEmails'
import type { User } from '../types'

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (user?.email) rememberLoginEmail(user.email)
  }, [user?.email])

  const signOut = async () => {
    await recordWebAuditEvent('logout')
    await supabase.auth.signOut()
    clearMfaActivity()
  }

  return { user, loading, signOut }
}

