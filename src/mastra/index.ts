import 'dotenv/config';
import { Mastra } from "@mastra/core";
import { registerApiRoute } from "@mastra/core/server";
import axios from "axios";


// Agentes y Herramientas
import { getRealEstateAgent } from "./agents/real-estate-agent"; 
import { realEstateCleaningAgent } from "./agents/real-estate-cleaning-agent";
import { realEstatePropertyFormatterTool } from "./tools/real-estate-property-formatter";

// Storage y Servicios
import { storage, vectorStore, ThreadContextService } from './storage'; 

// Prompts y Helpers
import { dynamicInstructions } from '../prompts/fausti-prompts';

import { ClientData, OperacionTipo } from '../types';
// Workflows
import { propertyWorkflow } from "./workflows/scrapper-workflow";

/**
 * INICIALIZACIÓN DE STORAGE
 */
await storage.init();

// Instancia base del agente para el sistema Mastra (registro interno)
const realEstateAgent = await getRealEstateAgent('');

export const mastra = new Mastra({
  storage,
  vectors: { vectorStore },
  agents: { realEstateAgent, realEstateCleaningAgent },
  tools: { realEstatePropertyFormatterTool },
  workflows: { propertyWorkflow },
  server: {
    port: 4111,
    apiRoutes: [
      registerApiRoute('/chat', {
        method: 'POST',
        handler: async (c: any) => {
          try {
            const body = await c.req.json();
            console.log("📨 RAW BODY RECIBIDO:", JSON.stringify(body, null, 2)); // <--- ESTO IMPRIMIRÁ TODO LO QUE LLEGA
            let message = body.custom_fields.endResponse;
            let threadId = body.id;
            let userId = body.id;
            let clientData = {}
            // --- 🛑 ZONA DE DEBUGGING 🛑 ---
            console.log("\n🔥🔥🔥 INICIO DEL REQUEST 🔥🔥🔥");
            console.log("1. ThreadID recibido:", threadId);
            console.log("2. ClientData CRUDA:", clientData);
            console.log("3. ¿Tiene llaves?", clientData ? Object.keys(clientData) : "Es Null/Undefined");
            // ------------------------------

            // Relaxed check: Manychat might not send threadId
            if (!threadId && !userId) {
              return c.json({ error: "Either ThreadID or UserID is required" }, 400);
            }

            const currentThreadId = threadId || `chat_${userId}`;
            const urlRegex = /(https?:\/\/[^\s]+)/g;
            const linksEncontrados = message?.match(urlRegex);

            // 1. GESTIÓN DE CONTEXTO (MEMORIA)
            // Definimos una variable única para acumular datos
            let finalContextData: ClientData = {};
            finalContextData.operacionTipo = '';
            let propertyOperationType: OperacionTipo  = '';

            try {
              // A. Actualizar DB si viene info nueva del cliente
              if (clientData && Object.keys(clientData).length > 0) {
                  // CAMBIO AQUI: Le pasamos 'userId' como segundo parámetro
                  // Asegúrate de que 'userId' no sea undefined. Si lo es, usa un default.
                  const validResourceId = userId || "anonymous_user"; 
                  
                  await ThreadContextService.updateContext(threadId, validResourceId, clientData);
              }

              // B. Leer la verdad absoluta de la DB
              // Usamos una variable temporal 'dbContext' para no confundir scopes
              const dbContext = await ThreadContextService.getContext(threadId);

                const mastraProfile = await ThreadContextService.getResourceProfile(userId);
                  console.log("🧠 [PERFIL MASTRA DETECTADO]:", mastraProfile);

              console.log("🔍 [DB] Datos guardados en Base de Datos:", dbContext); // <--- AGREGA ESTO
              // C. Mezclar: Prioridad a lo que dice la DB, fallback a clientData del request
              finalContextData = { 
                  ...mastraProfile, // 1. Base (Mastra)
                  ...dbContext,     // 2. Contexto Thread
                  ...(clientData || {}) // 3. Override actual
              } as ClientData;
              console.log("🧠 [MEMORIA FINAL] Esto es lo que sabrá el agente:", finalContextData); // <--- ESTO ES LO QUE BUSCAS

            } catch (err) {
              console.error("⚠️ Error gestionando contexto en DB (usando fallback):", err);
              finalContextData = clientData || {} as ClientData; 
            }

            // =================================================================================
            // MODO SINCRONO (Generate) - Habilitado para WhatsAppStyleProcessor
            // =================================================================================
            // =================================================================================
            // MODO ASÍNCRONO (Ack & Push) - Manychat
            // =================================================================================
            console.log(`⏱️ [${new Date().toISOString()}] Inicio Request Handler`);

            // 1. RESPUESTA INMEDIATA (ACK) para evitar Timeout de Manychat
            // Solo respondemos inmediatamente si es Manychat (tiene userId)
            if (userId && body.custom_fields) {
               console.log("⚡ Enviando ACK inmediato a Manychat para evitar timeout...");
               // Enviamos respuesta HTTP 200 al instante
               c.json({
                   response_text: "🧐 Dame un momento, estoy analizando la información...",
                   status: "processing"
               });
               // IMPORTANTE: NO hacemos return todavía si queremos que la función siga ejecutando en background.
               // En Hono/Express, c.json() suele enviar la respuesta. asegurémosnos de no bloquear.
               // Nota: En algunos frameworks serverless, el proceso muere al responder. En Node/Docker persistente (tu caso) sigue vivo.
            }

            // 2. PROCESO EN BACKGROUND (Promise sin await bloquante al request HTTP inicial)
            (async () => {
                try {
                    console.log("🏃‍♂️ Iniciando proceso en background...");

                    // --- BLOQUE DE SCRAPING / WORKFLOW (Síncrono/Background) ---
                    if (linksEncontrados && linksEncontrados.length > 0) {
                      const url = linksEncontrados[0].trim();
                      finalContextData.link = url;

                      // Limpieza de contexto inmediata al detectar nueva propiedad
                      if (currentThreadId) {
                          await ThreadContextService.clearThreadMessages(currentThreadId);
                      }

                      try {
                        const workflow = mastra.getWorkflow('propertyWorkflow');
                        const run = await workflow.createRun();
                        
                        console.log(`🚀 Iniciando Workflow para: ${url}`);
                        const result = await run.start({ inputData: { url } });

                        if (result.status !== 'success') {
                          console.error(`❌ Workflow failed: ${result.status}`);
                        } else if (result.result) {
                            const outputLogica = result.result;
                            console.log("📦 Output Workflow recibido");

                            // CAPTURAMOS el tipo de operación
                            if (outputLogica.operacionTipo) {
                                propertyOperationType = outputLogica.operacionTipo;
                                console.log("🚀 Tipo de operación detectado:", propertyOperationType);
                                finalContextData.operacionTipo = outputLogica.operacionTipo;
                                finalContextData.propertyAddress = outputLogica.address;
                            }
                        }
                      } catch (workflowErr) {
                        console.error("❌ Workflow error:", workflowErr);
                      }
                    }

                    // 3. GENERACIÓN DEL PROMPT FINAL
                    console.log("📝 [PROMPT] Generando instrucciones con:", finalContextData);
                    const contextoAdicional = dynamicInstructions(finalContextData, propertyOperationType.toUpperCase() as OperacionTipo);
                    console.log("📝 [PROMPT] Contexto adicional:", contextoAdicional);

                    // 4. CREACIÓN DINÁMICA DEL AGENTE
                    const agent = await getRealEstateAgent(userId, contextoAdicional, finalContextData.operacionTipo );

                    // @ts-ignore
                    console.log("🛠️ Tools disponibles para el agente:", Object.keys((agent as any).tools || {}));
                    console.log("🤖 Generando respuesta final (Background)...");

                    const response = await agent.generate(message, {
                        threadId: currentThreadId,
                        resourceId: userId,
                    });

                    console.log("✅ Respuesta final generada:", response.text);

                    // 5. ENVIAR A MANYCHAT (PUSH)
                    if (userId && body.custom_fields) {
                        await sendToManychat(userId, response.text);
                        console.log("📤 Mensaje enviado proactivamente a Manychat.");
                    } else {
                        // Si era un request normal (curl/postman) y ya respondimos ACK, no verán esto en la HTTP response.
                        // Solo queda en log.
                        console.log("ℹ️ Respuesta generada (modo background), pero cliente no es Manychat/Async.");
                    }

                } catch (bgError: any) {
                    console.error("💥 Error en proceso background:", bgError);
                    // Opcional: Avisar a Manychat del error
                    if (userId && body.custom_fields) {
                         await sendToManychat(userId, "Lo siento, tuve un error técnico analizando esa propiedad.");
                    }
                }
            })(); // IIFE ejecutada inmediatamente

            // Si ya enviamos c.json() arriba, Hono/Mastra podría haber cerrado el stream.
            // Para asegurar compatibilidad con la estructura devuelta, retornamos algo simple.
            // Si el c.json() arriba ya envió headers, esto podría ser redundante pero seguro.
            return; 

            /*
            // OLD SYNC BLOCK REMOVED
            */

          } catch (error) {
            console.error("💥 Error general en el handler:", error);
            return c.json({ error: "Internal Server Error" }, 500);
          }
        }
      })
    ]
  }
});

// Helper para Manychat Push
async function sendToManychat(subscriberId: string, text: string) {
    const apiKey = process.env.MANYCHAT_API_KEY;
    if (!apiKey) {
        console.error("❌ MANYCHAT_API_KEY is missing in .env");
        return;
    }

    try {
        console.log(`📤 Push a Manychat (${subscriberId})...`);
        await axios.post('https://api.manychat.com/fb/subscriber/sendContent', {
            subscriber_id: subscriberId,
            data: {
                version: 'v2',
                content: {
                    messages: [{ type: 'text', text: text }]
                }
            }
        }, { headers: { Authorization: `Bearer ${apiKey}` } });
        
    } catch (err: any) {
        console.error("❌ Error sending to Manychat:", err.response?.data || err.message);
    }
}