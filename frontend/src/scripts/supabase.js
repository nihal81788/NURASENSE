import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://rtqeevykhqomyoyxeebf.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_xmsGv26EwRbB0C2xtMVwAA_Rs8-3O9Q';

/**
 * NuraSense Cloud Database & Tokenized Auth Engine
 * Powered by Supabase PostgreSQL (AWS Cloud).
 * Handles bcrypt-hashed credentials, tokenized sessions, and 6-digit email OTPs.
 */
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

