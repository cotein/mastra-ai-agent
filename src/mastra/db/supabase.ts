import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY!;

// Usamos Service Role para asegurar que el agente pueda leer/escribir sin restricciones de RLS si es necesario
export const supabase = createClient(supabaseUrl, supabaseKey);

export const getSupabase = () => supabase;