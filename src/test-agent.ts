import 'dotenv/config';
import crypto from 'node:crypto';
import dns from 'node:dns';

// FORCE IPv4: Monkey-patch dns.lookup to avoid IPv6 connection issues (ECONNREFUSED)
const originalLookup = dns.lookup;
dns.lookup = ((hostname: string, options: any, callback: any) => {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  } else if (!options) {
    options = {};
  }
  
  // Force IPv4
  const newOptions = { ...options, family: 4 };
  
  // @ts-ignore
  return originalLookup(hostname, newOptions, callback);
}) as any;

if (!globalThis.crypto) {
  // @ts-ignore
  globalThis.crypto = crypto;
}

// test-memory.ts
import { getRealEstateAgent } from './mastra/agents/real-estate-agent';

async function test() {
  console.log("Iniciando test...");
  const userId = "whatsapp-user-123";
  console.log("Obteniendo agente para usuario:", userId);
  const agent = await getRealEstateAgent(userId);
  console.log("Agente obtenido.");

  // IMPORTANTE: Para que persista, debes pasar un threadId
  // En una app real, el threadId sería el ID de la conversación de WhatsApp
  console.log("Generando 10 mensajes...");
  for (let i = 0; i < 10; i++) {
    console.log(`\n--- Mensaje ${i + 1}/10 ---`);
    const result = await agent.generate(`Mensaje de prueba ${i + 1} del usuario Diego. ¿Hay novedades?`, {
      threadId: "conversacion_diego_001", 
      resourceId: userId
    });
    console.log("Respuesta de Nico:", result.text);
  }
  console.log("Revisá tu tabla chat_messages en Supabase ahora.");
}

test();