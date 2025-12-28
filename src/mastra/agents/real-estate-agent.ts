import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { TokenLimiter, ToolCallFilter } from "@mastra/core/processors";
import { PostgresStore } from "@mastra/pg";

// Herramientas y utilidades
import { propiedadMasCercanaTool } from '../tools/propiedad_mas_cercana';
import { calendarManagerTools } from '../tools/google-calendar';
import { gmailManagerTools } from '../tools/google-gmail';
import { apifyScraperTool } from '../tools/apify-scrapper-tool';
import { updateClientPreferencesTool } from '../tools/memory-tools';
import { searchPropertyMemoryTool, searchClientHistoryTool } from '../tools/rag-tools';
import { createClient } from '@supabase/supabase-js';
import { potentialSaleEmailTool } from '../tools/index';
import { procesarNuevaPropiedad } from '../tools/procesa-nueva-propiedad';
import { dynamicInstructions } from './../../prompts/fausti-propiedades-2025-12-23';

// 1. Inicialización de Supabase
const getSupabase = () => createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY!
);


// 2. Configuración del Almacenamiento Persistente (Mastra Storage)
// Esto conecta Mastra con tus tablas chat_sessions y chat_messages [cite: 1251]
// 2. Configuración del Almacenamiento Persistente (Mastra Storage)
// Esto conecta Mastra con tus tablas chat_sessions y chat_messages [cite: 1251]
const storage = new PostgresStore({
  id: 'postgres-store',
  connectionString: process.env.SUPABASE_POSTGRES_URL!,
  tableName: 'chat_messages',
});

/**
 * 3. Configuración de Memoria con Procesadores
 * Utilizamos procesadores para optimizar la ventana de contexto[cite: 447, 451].
 */
const agentMemory = new Memory({
  storage,
});

/**
 * 4. Configuración Base del Agente
 */
const agentConfig = {
    id: "real-estate-agent",
    name: "Nico",
    model: "openai/gpt-4o-mini",
    memory: agentMemory,
    tools: {
      encontrar_propiedad_cercana: propiedadMasCercanaTool,
      ...calendarManagerTools,
      ...gmailManagerTools,
      apify_scraper: apifyScraperTool,
      update_client_preferences: updateClientPreferencesTool,
      search_property_memory: searchPropertyMemoryTool,
      search_client_history: searchClientHistoryTool,
      potential_sale_email: potentialSaleEmailTool,
      procesar_nueva_propiedad: procesarNuevaPropiedad,
    },
    toolChoice: 'auto',
    inputProcessors: [
        // Elimina logs verbose de herramientas para mantener el chat limpio [cite: 472, 474]
        new ToolCallFilter({ 
          exclude: ['apify_scraper', 'enviar_correo', 'search_property_memory'] 
        }),
        // Evita errores de límite de tokens podando mensajes antiguos [cite: 452, 454]
        new TokenLimiter(2000), 
    ],
};

/**
 * 5. Función de recuperación de Memoria de Entidades (Largo Plazo)
 * Implementa el concepto de 'Working Memory' del libro[cite: 383, 384].
 */
/* async function getLongTermMemory(userId: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('client_profiles')
    .select('preferences, summary')
    .eq('user_id', userId)
    .single();

  if (error || !data) return "Cliente nuevo: Sin preferencias previas.";

  return `
    RECUERDA SOBRE ESTE CLIENTE (MEMORIA A LARGO PLAZO):
    - Preferencias actuales: ${JSON.stringify(data.preferences)}
    - Resumen histórico: ${data.summary || 'Sin resumen'}
  `;
} */

export const getRealEstateAgent = async (userId: string) => {
  const supabase = getSupabase();
  
  const ADMIN_ID = "tu-numero-de-telefono-o-id"; 
  const isAdmin = userId === ADMIN_ID;

  // Buscamos el perfil en client_profiles 🗂️
  const { data: profile } = await supabase
    .from('client_profiles')
    .select('preferences, summary')
    .eq('user_id', userId)
    .single();

  const nombreExtraido = profile?.preferences?.nombre || profile?.preferences?.name;
  const esRecurrente = !!profile;

  // 🔴 AGREGA ESTO AQUÍ
  console.log('--- DEBUG SUPABASE PROFILE ---');
  console.log('User ID buscado:', userId);
  console.log('Data cruda de Supabase:', profile);
  console.log('------------------------------');

  // Generamos el prompt "fresco"
  const instrucciones = dynamicInstructions({
    nombre: nombreExtraido,
    esRecurrente: esRecurrente,
    isAdmin: true
  });

  // Agregamos el ancla de memoria a largo plazo al final de las instrucciones
  const ltmContext = profile ? `
    \nRECUERDA SOBRE ESTE CLIENTE:
    - Preferencias: ${JSON.stringify(profile.preferences)}
    - Resumen: ${profile.summary || 'Sin historial previo'}
  ` : "";

  return new Agent({
    ...agentConfig,
    instructions: instrucciones + ltmContext,
  });
};

export const realEstateAgent = new Agent({
  ...agentConfig,
  instructions: dynamicInstructions({ esRecurrente: false }),
});