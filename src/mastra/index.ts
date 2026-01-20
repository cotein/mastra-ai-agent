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
import { sleep } from '../helpers/sleep';

/**
 * INICIALIZACIÓN DE STORAGE
 */
await storage.init();

// Instancia base del agente para el sistema Mastra (registro interno)
const realEstateAgent = await getRealEstateAgent('');

// Cache simple para deduplicar requests (TTL 15s)
const activeProcessing = new Set<string>();

// Memoria de sesión para el tipo de operación (Persistencia RAM)
const sessionOperationMap = new Map<string, OperacionTipo>();
const sessionLinkMap = new Map<string, string>();
const sessionPropiedadInfoMap = new Map<string, string>();

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
            // Log movido abajo
            let message = body.custom_fields.endResponse;
            let whatsappPhone = body.whatsapp_phone;
            let threadId = body.id;
            let userId = body.id;
            // FIX: Inicializar clientData con el teléfono si existe, para que sobreviva al merge de contextos
            let clientData: any = {};
            if (whatsappPhone) {
                clientData.telefono = whatsappPhone;
            }
            console.log("\n🔥🔥🔥 INICIO DEL REQUEST 🔥🔥🔥");

            if (!threadId && !userId) {
              return c.json({ error: "Either ThreadID or UserID is required" }, 400);
            }

            const currentThreadId = threadId || `chat_${userId}`;
            const urlRegex = /(https?:\/\/[^\s]+)/g;
            const linksEncontrados = message?.match(urlRegex);

            const requestHash = `${userId || 'anon'}_${message?.substring(0, 50)}`; 
            
            if (activeProcessing.has(requestHash)) {
                 console.log(`⚠️ Request duplicado detectado (Hash: ${requestHash}). Ignorando...`);
                 return c.json({ status: "ignored_duplicate" }); 
            }
            
            // Marcamos como activo con un TTL de seguridad (ej. 15 segs)
            activeProcessing.add(requestHash);
            setTimeout(() => activeProcessing.delete(requestHash), 15000); // Autolimpieza por si acaso

            // =================================================================================
            // 1. RESPUESTA INMEDIATA (ACK) - CRÍTICO PARA EVITAR RETRIES DE MANYCHAT
            // =================================================================================
            // Enviamos el ACK *antes* de cualquier operación de base de datos o lógica pesada.
            let ackResponse = undefined;
            if (userId && body.custom_fields) {
               console.log("⚡ Enviando ACK inmediato a Manychat (PRE-DB) para evitar timeout/duplicados...");
               ackResponse = c.json({
                   response_text: "", // Texto vacío para que Manychat no muestre nada y espere el Push
                   status: "processing"
               });
            }

            // =================================================================================
            // 2. PROCESO EN BACKGROUND (Fire & Forget)
            // =================================================================================
            (async () => {
                try {
                    // Definimos una variable única para acumular datos
                    let finalContextData: ClientData = {};
                    finalContextData.telefono = whatsappPhone;
                    // Recuperar tipo de operación de la sesión (RAM) como default
                    let propertyOperationType: OperacionTipo  = sessionOperationMap.get(currentThreadId) || '';
                    finalContextData.operacionTipo = propertyOperationType;

                    try {
                      // Actualizar DB si viene info nueva del cliente
                      if (clientData && Object.keys(clientData).length > 0) {
                          const validResourceId = userId || "anonymous_user"; 
                          await ThreadContextService.updateContext(threadId, validResourceId, clientData);
                      }

                      // Leer la verdad absoluta de la DB
                      const dbContext = await ThreadContextService.getContext(threadId);
                      const mastraProfile = await ThreadContextService.getResourceProfile(userId);

                      finalContextData = { 
                          ...mastraProfile, // 1. Base (Mastra)
                          ...dbContext,     // 2. Contexto Thread
                          ...(clientData || {}) // 3. Override actual
                      } as ClientData;

                      // FIX: Recuperar operacionTipo de DB si no está en RAM
                      if (!propertyOperationType && finalContextData.operacionTipo) {
                          propertyOperationType = finalContextData.operacionTipo;
                          sessionOperationMap.set(currentThreadId, propertyOperationType);
                      }

                    } catch (err) {
                      console.error("⚠️ Error gestionando contexto en DB (usando fallback):", err);
                      // Fallback: intentar seguir con lo que tenemos
                      finalContextData = clientData || {} as ClientData; 
                    }

                    // Recuperar LINK de la sesión (RAM) si existe para mantener contexto
                    if (!finalContextData.link && sessionLinkMap.has(currentThreadId)) {
                        finalContextData.link = sessionLinkMap.get(currentThreadId);
                    } else if (finalContextData.link && !sessionLinkMap.has(currentThreadId)) {
                        // Sync DB -> RAM
                        sessionLinkMap.set(currentThreadId, finalContextData.link);
                    }

                    // Recuperar PropiedadInfo de la sesión (RAM) si existe
                    if (!finalContextData.propiedadInfo && sessionPropiedadInfoMap.has(currentThreadId)) {
                         finalContextData.propiedadInfo = sessionPropiedadInfoMap.get(currentThreadId);
                    } else if (finalContextData.propiedadInfo && !sessionPropiedadInfoMap.has(currentThreadId)) {
                         // Sync DB -> RAM
                         sessionPropiedadInfoMap.set(currentThreadId, finalContextData.propiedadInfo);
                    }

                    // B. WORKFLOW / LOGICA DE NEGOCIO
                    if (linksEncontrados && linksEncontrados.length > 0) {
                      const url = linksEncontrados[0].trim();
                      finalContextData.link = url;
                      
                      // ACTUALIZAR LINK EN SESIÓN
                      sessionLinkMap.set(currentThreadId, url);
                      
                      if (currentThreadId) {
                          await ThreadContextService.clearThreadMessages(currentThreadId);
                      }
                      
                      try {
                        const workflow = mastra.getWorkflow('propertyWorkflow');
                        const run = await workflow.createRun();
                        const result = await run.start({ inputData: { url } });

                        if (result.status !== 'success') {
                          console.error(`❌ Workflow failed: ${result.status}`);
                        } else if (result.result) {
                            const outputLogica = result.result;
                            console.log("📦 Output Workflow recibido",   outputLogica);
                            if (outputLogica.operacionTipo) {
                                propertyOperationType = outputLogica.operacionTipo;
                                finalContextData.operacionTipo = outputLogica.operacionTipo;
                                finalContextData.propertyAddress = outputLogica.address;
                                finalContextData.propiedadInfo = outputLogica.minimalDescription || "Sin descripción disponible";
                                finalContextData.operacionTipo = outputLogica.operacionTipo; // Asegurar consistencia con nombres

                                sessionOperationMap.set(currentThreadId, propertyOperationType);
                                sessionPropiedadInfoMap.set(currentThreadId, finalContextData.propiedadInfo);
                                
                                const validResourceId = userId || "anonymous_user"; 
                                await ThreadContextService.updateContext(threadId, validResourceId, {
                                    operacionTipo: propertyOperationType,
                                    propiedadInfo: finalContextData.propiedadInfo,
                                    link: url
                                });
                            }
                        }
                      } catch (workflowErr) {
                        console.error("❌ Workflow error:", workflowErr);
                      }
                    }

                    // C. GENERACIÓN DEL PROMPT FINAL
                    console.log("📝 [PROMPT] Generando instrucciones con:", finalContextData);
                    const contextoAdicional = dynamicInstructions(finalContextData, propertyOperationType.toUpperCase() as OperacionTipo);
                    
                    // D. CREACIÓN DINÁMICA DEL AGENTE
                    const agent = await getRealEstateAgent(userId, contextoAdicional, finalContextData.operacionTipo );
                    
                    const response = await agent.generate(message, {
                        threadId: currentThreadId,
                        resourceId: userId
                    });

                    // Inspeccionar resultados AQUÍ, después del await
                    if (response.toolResults && response.toolResults.length > 0) {
                        response.toolResults.forEach((toolRes: any) => {
                            if (toolRes.status === 'error' || toolRes.error) {
                                console.error(`❌ [ERROR CRÍTICO POST-EXEC] Tool '${toolRes.toolName}' falló:`);
                                console.error(`   Motivo:`, JSON.stringify(toolRes.error || toolRes.result, null, 2));
                            }
                        });
                    }
                    // E. ENVIAR A MANYCHAT (PUSH)
                    if (userId && body.custom_fields) {
                        
                        // SPLIT Y ENVIO SECUENCIAL
                        const parts = response.text.split(/\n\s*\n/).filter(p => p.trim().length > 0);

                        for (const part of parts) {
                            await sendToManychat(userId, part);
                            // Pequeño delay aleatorio entre bloques (2-10s)
                            if (parts.length > 1) {
                                const randomDelay = Math.floor(Math.random() * (10 - 2 + 1)) + 2;
                                await sleep(randomDelay); 
                            }
                        }
                    } else {
                        console.log("ℹ️ Respuesta generada (modo background), pero cliente no es Manychat/Async.");
                    }

                } catch (bgError: any) {
                    console.error("💥 Error en proceso background:", bgError);
                    if (userId && body.custom_fields) {
                         await sendToManychat(userId, "Lo siento, tuve un error técnico analizando esa información.");
                    }
                } finally {
                    // Limpiamos el hash para permitir nuevos mensajes en el futuro
                    // Pero dejamos un delay extra para asegurar que Manychat no reintente inmediatemente
                    // activeProcessing.delete(requestHash); // Ya lo hace el setTimeout, pero si terminó antes...
                    // Mejor confiamos en el setTimeout para el de-bounce de retries.
                }
            })(); // Fin IIFE

            // RETORNO INMEDIATO
            if (ackResponse) {
                return ackResponse;
            }
            
            return c.json({ status: "started_background_job" }); 
 

            // RETORNAR LA RESPUESTA (IMPORTANTE)
            // Si creamos un ACK, lo devolvemos. Si no, devolvemos un JSON genérico 'processing'
            // (aunque en uso normal sin Manychat quizás esperarías la respuesta full, 
            //  pero para unificar arquitectura async, devolvemos esto siempre o esperamos si no es Manychat).
            
            // Si NO es Manychat, idealmente deberíamos esperar el resultado (behavior original), 
            // pero para arreglar Manychat YA, priorizamos devolver ackResponse.
            if (ackResponse) {
                return ackResponse;
            }
            
            // Fallback para tools/pruebas simples que no mandan custom_fields:
            return c.json({ status: "started_background_job" }); 

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
    // HARDCODED API KEY (Per user request for PROD hotfix)
    const apiKey = "3448431:145f772cd4441c32e7a20cfc6d4868f6"; 
    
    const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
    };

    try {
        console.log(`1️⃣ [Manychat] Setting Custom Field 'response1' for ${subscriberId}...`);
        
        // 1. Set Custom Fields
        const setFieldRes = await axios.post('https://api.manychat.com/fb/subscriber/setCustomFields', {
            subscriber_id: Number(subscriberId), // Ensure number if needed, though string often works. API docs say subscriber_id: 0 (schema), so number usually.
            fields: [
                {
                    field_name: "response1",
                    field_value: text
                }
            ]
        }, { headers });
        
        console.log("✅ Custom Field Set:", setFieldRes.data);


        console.log(`2️⃣ [Manychat] Sending Flow 'content20250919131239_298410' to ${subscriberId}...`);
        
        await sleep(2)
        // 2. Send Flow
        const sendFlowRes = await axios.post('https://api.manychat.com/fb/sending/sendFlow', {
            subscriber_id: Number(subscriberId),
            flow_ns: "content20250919131239_298410"
        }, { headers });

        console.log("✅ Flow Sent:", sendFlowRes.data);

    } catch (err: any) {
        // Loguear TODO el error para ver qué dice Manychat
        console.error("❌ Error interacting with Manychat:", JSON.stringify(err.response?.data || err.message, null, 2));
    }
}