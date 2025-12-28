import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';

const getSupabase = () => createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const updateClientPreferences = createTool({
  id: "update_client_preferences",
  description: "Guarda o actualiza nombre, email y preferencias en client_profiles.",
  inputSchema: z.object({
    nombre: z.string().optional(),
    email: z.string().email().optional(),
    zona_interes: z.string().optional()
  }),
  execute: async (inputData, { context }) => {
    const supabase = getSupabase();
    const userId = context?.userId;
    const { error } = await supabase.from("client_profiles").upsert({
      user_id: userId,
      preferences: inputData,
      last_interaction: /* @__PURE__ */ new Date()
    });
    return { success: !error, data: inputData };
  }
});

export { updateClientPreferences };
