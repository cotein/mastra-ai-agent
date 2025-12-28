import { createTool } from '@mastra/core/tools';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import OpenAI from 'openai';

const getSupabase = () => createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY!
);

const getOpenAI = () => new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const buscarPropiedadesTool = createTool({
  id: 'buscar_propiedades',
  description: 'Busca casas por descripción emocional o cualitativa',
  inputSchema: z.object({
    query: z.string(),
  }),
  execute: async ({ query }) => {
    // 1. Convertimos el TEXTO del usuario en un VECTOR (Números)
    // Usamos el modelo de embeddings que definiste en la configuración
    const openai = getOpenAI();
    const supabase = getSupabase();

    try {
      const embeddingResponse = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: query,
      });

      const [{ embedding }] = embeddingResponse.data;

      // 2. Ahora sí, buscamos en la base de datos usando el VECTOR
      // Usamos RPC de Supabase como en rag-tools para búsqueda vectorial
      const { data: propiedades, error } = await supabase.rpc('match_properties', {
        query_embedding: embedding,
        match_threshold: 0.5,
        match_count: 3,
        // filter_op y filter_price no están en el input, pasamos defaults o null
        filter_op: null,
        filter_price: 999999999
      });

      if (error) throw error;

      return propiedades;
    } catch (error: any) {
      console.error('Error en buscar_propiedades:', error);
      return { success: false, error: error.message };
    }
  },
});