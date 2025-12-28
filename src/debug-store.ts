import 'dotenv/config';
import { PostgresStore } from "@mastra/pg";

async function debugStore() {
  console.log("🛠️ Iniciando Debug de Memoria en Mastra...");

  // IMPORTANTE: Mastra usa tablas internas (mast_*) por defecto. 
  // Tu esquema tiene tablas personalizadas. 
  // Aquí inicializamos el store de Postgres.
  const storage = new PostgresStore({
    id: 'main-storage',
    connectionString: process.env.SUPABASE_POSTGRES_URL!,
  });

  const TEST_THREAD_ID = "debug-thread-" + Date.now();
  const TEST_RESOURCE_ID = "rapsodia-user-test"; // Identificador para pruebas

  try {
    console.log(`1. Creando Thread: ${TEST_THREAD_ID}...`);
    
    await storage.saveThread({
      thread: {
        id: TEST_THREAD_ID,
        resourceId: TEST_RESOURCE_ID,
        createdAt: new Date(),
        updatedAt: new Date(),
        title: 'Prueba desde Script',
        metadata: { source: 'debug-script' }
      }
    });

    console.log("2. Guardando Mensaje de prueba...");
    
    // Aquí es donde corregimos el error: incluimos resourceId y threadId
    const result = await storage.saveMessages({
        messages: [{
            id: 'msg-' + Date.now(),
            role: 'user',
            content: {
              format: 2, // Formato esperado por Mastra/AI SDK
              parts: [{ type: 'text', text: 'Hola Agente, probando persistencia.' }]
            },
            createdAt: new Date(),
            threadId: TEST_THREAD_ID,
            resourceId: TEST_RESOURCE_ID, // <--- CRUCIAL PARA EVITAR EL ERROR
        }],
    });
    
    console.log("✅ ¡Éxito! Mensaje persistido en Postgres.");
    
    // Verificación: Intentar recuperar los mensajes
    const { messages: history } = await storage.listMessages({ threadId: TEST_THREAD_ID });
    console.log(`3. Recuperados ${history.length} mensajes del hilo.`);

  } catch (error: any) {
    console.error("❌ ERROR EN EL STORE:");
    console.error("Mensaje:", error.message);
    if (error.cause) console.error("Causa:", error.cause);
    console.error("Detalles:", error.details);
  }
}

debugStore();