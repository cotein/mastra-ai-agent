import { createTool } from '@mastra/core/tools';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

const getSupabase = () => createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);
const updateClientPreferencesTool = createTool({
  id: "update_client_preferences",
  description: "Actualiza o guarda los datos y preferencias del cliente (nombre, email, tel\xE9fono, presupuesto, zona, etc.) en la base de datos.",
  inputSchema: z.object({
    userId: z.string().describe("El identificador \xFAnico del usuario"),
    preferences: z.object({
      // DATOS DE CONTACTO (Añadidos para que no fallen)
      nombre: z.string().optional().describe("Nombre del cliente"),
      name: z.string().optional().describe("Nombre del cliente (alias)"),
      email: z.string().email().optional().describe("Email de contacto"),
      telefono: z.string().optional().describe("Tel\xE9fono de contacto"),
      phone: z.string().optional().describe("Tel\xE9fono de contacto (alias)"),
      // PREFERENCIAS INMOBILIARIAS
      budget_max: z.number().optional().describe("Presupuesto m\xE1ximo"),
      preferred_zones: z.array(z.string()).optional().describe("Zonas de inter\xE9s"),
      min_rooms: z.number().optional().describe("Cantidad m\xEDnima de ambientes"),
      operation_type: z.string().optional().describe("ALQUILER o VENTA"),
      property_type: z.string().optional().describe("Tipo de propiedad (Casa, Depto, PH)")
    }).passthrough().describe("Objeto con los datos detectados. Se permiten campos adicionales."),
    // .passthrough() permite campos extra sin fallar
    observations: z.string().optional().describe("Resumen de la interacci\xF3n o notas adicionales")
  }),
  execute: async ({ userId, preferences, observations }) => {
    const supabase = getSupabase();
    console.log(`\u{1F680} Iniciando persistencia para usuario: ${userId}`);
    console.log("\u{1F4E6} Datos a guardar:", preferences);
    try {
      const { data: currentProfile } = await supabase.from("client_profiles").select("preferences, summary").eq("user_id", userId).single();
      const mergedPreferences = {
        ...currentProfile?.preferences || {},
        ...preferences
      };
      const finalSummary = observations ? `${currentProfile?.summary ? currentProfile.summary + " | " : ""}${observations}` : currentProfile?.summary;
      const { error } = await supabase.from("client_profiles").upsert({
        user_id: userId,
        preferences: mergedPreferences,
        summary: finalSummary,
        last_interaction: (/* @__PURE__ */ new Date()).toISOString()
      }, {
        onConflict: "user_id"
      }).select();
      if (error) {
        console.error("\u274C Error de Supabase al hacer upsert:", error.message);
        throw error;
      }
      console.log("\u2705 Datos persistidos correctamente en client_profiles");
      return {
        success: true,
        message: `Memoria de ${userId} actualizada correctamente.`,
        data: mergedPreferences
      };
    } catch (error) {
      console.error("\u274C Error fatal en update_client_preferences:", error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
});

export { updateClientPreferencesTool };
