import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getSupabase } from '../db/supabase';

export const updateClientPreferences = createTool({
  id: 'update_client_preferences',
  description: 'Guarda o actualiza nombre, email y preferencias en client_profiles.',
  inputSchema: z.object({
    nombre: z.string().optional(),
    email: z.string().email().optional(),
    zona_interes: z.string().optional(),
  }),
  execute: async (inputData, { context }: any) => {
    const supabase = getSupabase();
    const userId = context?.userId; // ID de WhatsApp o sesión
    const { data, error } = await supabase
      .from('client_profiles')
      .upsert({
        user_id: userId,
        preferences: inputData,
        last_interaction: new Date(),
      });
    return { success: !error, data: inputData };
  },
});