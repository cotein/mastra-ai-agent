import { createTool } from '@mastra/core/tools';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

const getSupabase = () => createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * SERVICIO DE MEMORIA
 */
export const memoryService = {
  // Guarda el historial de mensajes
  async saveMessage(sessionId: string, role: string, content: string) {
    const supabase = getSupabase();
    await supabase.from('chat_history').insert({ session_id: sessionId, role, content });
  },

  // Obtiene el perfil del cliente para inyectar en el prompt
  async getClientContext(userId: string) {
    const supabase = getSupabase();
    const { data } = await supabase
      .from('client_profiles')
      .select('*')
      .eq('user_id', userId)
      .single();
    return data;
  }
};

/**
 * TOOLS DE MEMORIA PARA EL AGENTE
 */
export const memoryTools = {
  // Tool para que el agente guarde lo que aprende del cliente
  update_client_memory: createTool({
    id: 'update_client_memory',
    description: 'Guarda preferencias del cliente como presupuesto, zona, cantidad de ambientes o tipo de operación.',
    inputSchema: z.object({
      userId: z.string().describe('ID único del usuario'),
      budget: z.number().optional().describe('Presupuesto máximo'),
      zone: z.string().optional().describe('Zona de interés (ej: Lomas de Zamora)'),
      propertyType: z.string().optional().describe('Tipo: Casa, Departamento, PH'),
      observations: z.string().optional().describe('Cualquier otro dato relevante')
    }),
    execute: async (input: { userId: string; budget?: number; zone?: string; propertyType?: string; observations?: string }) => {
      const supabase = getSupabase();
      const { userId, ...prefs } = input;
      
      const { data: existing } = await supabase
        .from('client_profiles')
        .select('preferences')
        .eq('user_id', userId)
        .single();

      const newPreferences = { ...(existing?.preferences || {}), ...prefs };

      const { error } = await supabase.from('client_profiles').upsert({
        user_id: userId,
        preferences: newPreferences,
        last_interaction: new Date().toISOString()
      });

      if (error) return { success: false, error: error.message };
      return { success: true, message: "Memoria actualizada correctamente." };
    }
  })
};