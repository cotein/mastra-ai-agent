
import { createCalendarEvent } from './src/mastra/tools/google-calendar';
import * as dotenv from 'dotenv';
dotenv.config();

async function runTest() {
  console.log("🚀 Iniciando prueba de agendamiento con LLM Parser...");
  console.log("Input: 'martes 20 a las 10hs' (Sin fecha fin explícita)");

  try {
    const result = await createCalendarEvent.execute!({
      start: "martes 20 a las 10hs", 
      clientName: "Usuario Test LLM",
      propertyAddress: "Calle Falsa 123",
      // No 'end' provided implies default duration logic check by LLM
    });

    console.log("Resultado:", JSON.stringify(result, null, 2));

    if (result.success) {
       console.log("✅ Éxito! Se agendó el evento.");
       if (result.scheduledStart) {
         console.log("Inicio agendado:", result.scheduledStart);
       }
    } else {
       console.log("❌ Falló la herramienta:", result.error);
    }

  } catch (error) {
    console.error("❌ Error ejecutando el test:", error);
  }
}

runTest();
