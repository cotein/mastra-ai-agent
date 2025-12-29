import { createTool } from '@mastra/core/tools';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import OpenAI from 'openai';

const getSupabase = () => createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY!
);

const getOpenAI = () => new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const searchPropertyMemoryTool = createTool({
  id: 'search_property_memory',
  description: 'Busca propiedades en la base de datos que coincidan con los deseos del cliente usando búsqueda semántica.',
  inputSchema: z.object({
    query: z.string().describe('Descripción de lo que busca el cliente (ej: depto 2 ambientes con balcón en Lomas)'),
    topK: z.number().optional().default(3).describe('Cantidad de propiedades a devolver'),
    filter: z.object({
      operation_type: z.enum(['ALQUILER', 'VENTA']).optional(),
      max_price: z.number().optional(),
    }).optional()
  }),
    execute: async (input) => {
    try {
      const openai = getOpenAI();
      const supabase = getSupabase();
      
      // 1. Generar el embedding de la búsqueda
      const embeddingResponse = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: input.query,
      });

      const [{ embedding }] = embeddingResponse.data;

      // 2. Llamada a la función RPC de Supabase para búsqueda vectorial
      // Nota: Debes crear la función 'match_properties' en tu SQL de Supabase
      const { data: properties, error } = await supabase.rpc('match_properties', {
        query_embedding: embedding,
        match_threshold: 0.5, // Ajustar según precisión deseada
        match_count: input.topK,
        filter_op: input.filter?.operation_type || null,
        filter_price: input.filter?.max_price || 999999999
      });

      if (error) throw error;

      return {
        success: true,
        results: properties.map((p: any) => ({
          id: p.id,
          titulo: p.metadata.title,
          precio: p.metadata.price,
          descripcion: p.content,
          link: p.metadata.url
        }))
      };
    } catch (error: any) {
      console.error('Error en RAG Tool:', error);
      return { success: false, error: error.message };
    }
  },
});

/**
 * NUEVA HERRAMIENTA: search_client_history
 * Permite al Admin buscar momentos específicos en las charlas de un cliente.
 */
export const searchClientHistoryTool = createTool({
  id: 'search_client_history',
  description: 'Obtiene el resumen y preferencias de un cliente específico para el Admin.',
  inputSchema: z.object({
    userId: z.string().describe('El ID o teléfono del cliente'),
  }),
  execute: async ({ userId }) => {
    const supabase = getSupabase();

    // En lugar de buscar en mensajes (que no tienen user_id), 
    // buscamos en el perfil que Nico actualiza constantemente.
    const { data: profile, error } = await supabase
      .from('client_profiles')
      .select('nombre, preferences, summary, last_interaction')
      .eq('user_id', userId)
      .single();

    if (error || !profile) {
      return { success: false, message: "No encontré a ningún cliente con ese ID." };
    }

    return {
      success: true,
      nombre: profile.nombre,
      resumen: profile.summary || "No hay un resumen redactado aún.",
      detalles: profile.preferences,
      ultima_vez: profile.last_interaction
    };
  },
});