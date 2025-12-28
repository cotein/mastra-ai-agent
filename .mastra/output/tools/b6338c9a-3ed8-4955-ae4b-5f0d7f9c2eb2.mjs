import { createTool } from '@mastra/core/tools';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import OpenAI from 'openai';

const getSupabase = () => createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);
const getOpenAI = () => new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const searchPropertyMemoryTool = createTool({
  id: "search_property_memory",
  description: "Busca propiedades en la base de datos que coincidan con los deseos del cliente usando b\xFAsqueda sem\xE1ntica.",
  inputSchema: z.object({
    query: z.string().describe("Descripci\xF3n de lo que busca el cliente (ej: depto 2 ambientes con balc\xF3n en Lomas)"),
    topK: z.number().optional().default(3).describe("Cantidad de propiedades a devolver"),
    filter: z.object({
      operation_type: z.enum(["ALQUILER", "VENTA"]).optional(),
      max_price: z.number().optional()
    }).optional()
  }),
  execute: async (input) => {
    try {
      const openai = getOpenAI();
      const supabase = getSupabase();
      const embeddingResponse = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: input.query
      });
      const [{ embedding }] = embeddingResponse.data;
      const { data: properties, error } = await supabase.rpc("match_properties", {
        query_embedding: embedding,
        match_threshold: 0.5,
        // Ajustar según precisión deseada
        match_count: input.topK,
        filter_op: input.filter?.operation_type || null,
        filter_price: input.filter?.max_price || 999999999
      });
      if (error) throw error;
      return {
        success: true,
        results: properties.map((p) => ({
          id: p.id,
          titulo: p.metadata.title,
          precio: p.metadata.price,
          descripcion: p.content,
          link: p.metadata.url
        }))
      };
    } catch (error) {
      console.error("Error en RAG Tool:", error);
      return { success: false, error: error.message };
    }
  }
});
const searchClientHistoryTool = createTool({
  id: "search_client_history",
  description: "Busca informaci\xF3n espec\xEDfica dentro del historial de conversaciones de un cliente usando b\xFAsqueda sem\xE1ntica.",
  inputSchema: z.object({
    userId: z.string().describe("El ID del usuario o cliente (ej: su tel\xE9fono)"),
    query: z.string().describe('Lo que quieres recordar (ej: "qu\xE9 dijo sobre el presupuesto" o "cuando quer\xEDa visitar")'),
    topK: z.number().optional().default(5).describe("Cantidad de mensajes relevantes a recuperar")
  }),
  execute: async ({ userId, query, topK }) => {
    try {
      const openai = getOpenAI();
      const supabase = getSupabase();
      const embeddingResponse = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: query
      });
      const [{ embedding }] = embeddingResponse.data;
      const { data: messages, error } = await supabase.rpc("match_messages", {
        query_embedding: embedding,
        match_threshold: 0.3,
        // Umbral un poco más bajo para captar lenguaje natural
        match_count: topK,
        filter_user_id: userId
        // Filtramos para buscar SOLO en la charla de ESE cliente
      });
      if (error) throw error;
      if (!messages || messages.length === 0) {
        const { data: profile } = await supabase.from("client_profiles").select("summary, preferences").eq("user_id", userId).single();
        return {
          success: true,
          source: "profile_summary",
          results: [{
            content: profile?.summary || "No hay resumen disponible.",
            preferences: profile?.preferences
          }],
          message: "No encontr\xE9 mensajes exactos, pero aqu\xED est\xE1 el resumen del perfil."
        };
      }
      return {
        success: true,
        source: "semantic_messages",
        results: messages.map((m) => ({
          texto: m.content,
          fecha: m.created_at,
          rol: m.role
        }))
      };
    } catch (error) {
      console.error("\u274C Error en search_client_history:", error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
});

export { searchClientHistoryTool, searchPropertyMemoryTool };
