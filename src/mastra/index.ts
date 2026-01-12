import 'dotenv/config';
import { Mastra } from "@mastra/core";
import { registerApiRoute } from "@mastra/core/server";
import { stream } from 'hono/streaming';

// Agentes y Herramientas
import { getRealEstateAgent } from "./agents/real-estate-agent"; 
import { realEstateCleaningAgent } from "./agents/real-estate-cleaning-agent";
import { realEstatePropertyFormatterTool } from "./tools/real-estate-property-formatter";

// Storage y Servicios
import { storage, vectorStore, ThreadContextService } from './storage'; 

// Prompts y Helpers
import { dynamicInstructions } from '../prompts/fausti-prompts';
import { randomSleep } from './../helpers/random-sleep';
import { frasesRevisareLink } from './../helpers/frases';
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


            // 2. STREAMING Y LÓGICA DE AGENTE
            return stream(c, async (streamInstance) => {

                console.log(`⏱️ [${new Date().toISOString()}] Inicio Stream Handler`);
            
                // --- BLOQUE DE SCRAPING / WORKFLOW ---
                if (linksEncontrados && linksEncontrados.length > 0) {
                  const url = linksEncontrados[0].trim();

                  finalContextData.link = url;

                  // NUEVO: Limpieza de contexto inmediata al detectar nueva propiedad
                  if (currentThreadId) {
                      await ThreadContextService.clearThreadMessages(currentThreadId);
                  }

                  // Feedback inmediato al usuario
                  await randomSleep(1, 3);

                  await streamInstance.write(frasesRevisareLink[Math.floor(Math.random() * frasesRevisareLink.length)] + "\n\n");

                  try {
                    const workflow = mastra.getWorkflow('propertyWorkflow');
                    const run = await workflow.createRun();
                    
                    console.log(`🚀 Iniciando Workflow para: ${url}`);
                    const result = await run.start({ inputData: { url } });

                    if (result.status !== 'success') {
                      throw new Error(`Workflow failed: ${result.status}`);
                    }

                    const outputLogica = result.result; // Asumiendo que workflow devuelve esto
                    
                    if (outputLogica) {
                        console.log("📦 Output Workflow recibido"); 
                        
                        // Si hay descripción mínima, la mostramos
                        if (outputLogica.minimalDescription) {
                            await streamInstance.write(outputLogica.minimalDescription + "\n\n");

                            await randomSleep(2, 4);
                            
                            await streamInstance.write(outputLogica.address + "\n\n");
                        }

                        // CAPTURAMOS el tipo de operación para el prompt, pero NO borramos finalContextData
                        if (outputLogica.operacionTipo) {
                            propertyOperationType = outputLogica.operacionTipo;
                            console.log("🚀 Tipo de operación detectado ########## :", propertyOperationType);

                            // Actualizamos también el objeto principal para consistencia
                            finalContextData.operacionTipo = outputLogica.operacionTipo;
                            finalContextData.propertyAddress = outputLogica.address;
                        }
                    }

                  } catch (workflowErr) {
                    console.error("❌ Workflow error:", workflowErr);
                    // No detenemos el stream; el agente contestará que no pudo ver el link o lo ignorará
                  }
                }
                // -------------------------------------

                try { 
                  // 3. GENERACIÓN DEL PROMPT FINAL
                  // Pasamos el objeto ClientData estrictamente tipado.
                  // También pasamos propertyOperationType por si dynamicInstructions tiene lógica de prioridad específica.
                  
                  console.log("📝 [PROMPT] Generando instrucciones con:", finalContextData);
                  
                  const contextoAdicional = dynamicInstructions(finalContextData, propertyOperationType.toUpperCase() as OperacionTipo);
                  //const contextoAdicional = dynamicInstructions(finalContextData, 'VENDER');
                  console.log("📝 [PROMPT] Contexto adicional:", contextoAdicional);
                  // 4. CREACIÓN DINÁMICA DEL AGENTE
                  const agent = await getRealEstateAgent(userId, contextoAdicional, finalContextData.operacionTipo );

                  // @ts-ignore
                  console.log("🛠️ Tools disponibles para el agente:", Object.keys((agent as any).tools || {}));

                  console.log("whatsapp-style: Volviendo a stream() por latencia. El estilo se manejará via Prompt.");
                  
                  const result = await agent.stream(message, {
                    threadId: currentThreadId,
                    resourceId: userId,
                  });

                  if (result.textStream) {
                    for await (const chunk of result.textStream) {
                      await streamInstance.write(chunk);
                    }
                  }
                } catch (streamError) {
                  console.error("💥 Error en el stream del agente:", streamError);
                  await streamInstance.write("\n\n[Lo siento, tuve un problema procesando tu respuesta final.]");
                }
            });

          } catch (error) {
            console.error("💥 Error general en el handler:", error);
            return c.json({ error: "Internal Server Error" }, 500);
          }
        }
      })
    ]
  }
});