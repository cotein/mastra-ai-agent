// memory-tools.ts corregido
import { createTool } from '@mastra/core/tools';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

// Inicialización del cliente de Supabase
const getSupabase = () => createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY!
);

export const updateClientPreferencesTool = createTool({
  id: 'update_client_preferences',
  description: 'Actualiza o guarda los datos y preferencias del cliente (nombre, email, teléfono, presupuesto, zona, etc.) en la base de datos.',
  inputSchema: z.object({
    userId: z.string().describe('El identificador único del usuario'),
    preferences: z.object({
      // DATOS DE CONTACTO (Añadidos para que no fallen)
      nombre: z.string().optional().describe('Nombre del cliente'),
      name: z.string().optional().describe('Nombre del cliente (alias)'),
      email: z.string().email().optional().describe('Email de contacto'),
      telefono: z.string().optional().describe('Teléfono de contacto'),
      phone: z.string().optional().describe('Teléfono de contacto (alias)'),
      
      // PREFERENCIAS INMOBILIARIAS
      budget_max: z.number().optional().describe('Presupuesto máximo'),
      preferred_zones: z.array(z.string()).optional().describe('Zonas de interés'),
      min_rooms: z.number().optional().describe('Cantidad mínima de ambientes'),
      operation_type: z.string().optional().describe('ALQUILER o VENTA'),
      property_type: z.string().optional().describe('Tipo de propiedad (Casa, Depto, PH)'),
    }).passthrough().describe('Objeto con los datos detectados. Se permiten campos adicionales.'), // .passthrough() permite campos extra sin fallar
    observations: z.string().optional().describe('Resumen de la interacción o notas adicionales')
  }),
  execute: async ({ userId, preferences, observations }) => {
    const supabase = getSupabase();

    console.log(`🚀 Iniciando persistencia para usuario: ${userId}`);
    console.log('📦 Datos a guardar:', preferences);

    try {
      // 1. Obtener perfil actual para no borrar datos viejos (Merge)
      const { data: currentProfile } = await supabase
        .from('client_profiles')
        .select('preferences, summary')
        .eq('user_id', userId)
        .single();

      // Combinamos lo que ya tenemos con lo nuevo
      const mergedPreferences = {
        ...(currentProfile?.preferences || {}),
        ...preferences
      };

      // Combinamos observaciones si ya existían para no perder historial
      const finalSummary = observations 
        ? `${currentProfile?.summary ? currentProfile.summary + ' | ' : ''}${observations}`
        : currentProfile?.summary;

      // 2. UPSERT: Inserta si no existe, actualiza si existe
      const { data, error } = await supabase
        .from('client_profiles')
        .upsert({
          user_id: userId,
          preferences: mergedPreferences,
          summary: finalSummary,
          last_interaction: new Date().toISOString()
        }, { 
          onConflict: 'user_id' 
        })
        .select();

      if (error) {
        console.error('❌ Error de Supabase al hacer upsert:', error.message);
        throw error;
      }

      console.log('✅ Datos persistidos correctamente en client_profiles');

      return {
        success: true,
        message: `Memoria de ${userId} actualizada correctamente.`,
        data: mergedPreferences
      };
    } catch (error: any) {
      console.error('❌ Error fatal en update_client_preferences:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  },
});