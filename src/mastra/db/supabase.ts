import { createClient } from '@supabase/supabase-js';

// Cliente para operaciones directas (Profiles/RAG) - Lazy load pattern
export const getSupabase = () => createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);