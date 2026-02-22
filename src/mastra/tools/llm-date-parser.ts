
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';

export const llmDateParser = createTool({
  id: 'llm_date_parser',
  description: 'Parses natural language date/time expressions into strict ISO 8601 format using an LLM. Handles complex phrases like "next Tuesday at 10", "tomorrow afternoon", etc. Enforces business rules.',
  inputSchema: z.object({
    dateDescription: z.string().describe('The natural language text describing the date and time (e.g., "martes 20 a las 10hs").'),
  }),
  execute: async (inputData) => {
    const { dateDescription } = inputData;
    console.log(`🤖 LLM Parser Invoked with: "${dateDescription}"`);

    const now = new Date();
    const currentIso = now.toISOString();
    const currentDayName = now.toLocaleDateString('es-AR', { weekday: 'long' });

   
    const prompt = `
      Eres un experto asistente de calendario para una inmobiliaria en Argentina. 
      Tu única función es convertir expresiones de fecha/hora en lenguaje natural a formato ISO 8601 estricto.

      CONTEXTO ACTUAL:
      - Fecha y Hora actual (Reference): ${currentIso}
      - Día de la semana actual: ${currentDayName}
      - Zona Horaria: America/Argentina/Buenos_Aires (-03:00)

      REGLAS DE NEGOCIO (ESTRICTAS):
      1. Si el usuario da solo fecha de inicio (ej: "martes 20 a las 10"), asume AUTOMÁTICAMENTE una duración de 1 HORA.
      2. Si la fecha mencionada ya pasó (ej: hoy es 20 y pide 'lunes 10'), asume que se refiere al futuro (mes siguiente o año siguiente), NUNCA al pasado.
      3. Interpreta prefijos coloquiales ("dale", "bueno", "agendame", "quiero el") como ruido. Ignóralos.
      4. "Mañana" se calcula desde la Fecha actual.
      5. Si no se especifica hora, asume 10:00 AM (horario laboral default).
      6. "Mediodía" = 12:00. "Tarde" = 15:00 (si no se especifica hora). "Noche" = 20:00.

      TU TAREA:
      Analiza el texto "${dateDescription}" y genera un JSON con start y end en formato ISO 8601 con offset correcto (-03:00).
    `; 

    try {
      const { object } = await generateObject({
        model: openai('gpt-4o-mini'),
        schema: z.object({
            start: z.string().describe("ISO 8601 start date-time with -03:00 offset"),
            end: z.string().describe("ISO 8601 end date-time with -03:00 offset"),
            explanation: z.string().describe("Brief reason for the calculation"),
        }),
        prompt: prompt,
        temperature: 0, // Deterministic
      });

      console.log(`✅ LLM Parsed Result:`, JSON.stringify(object, null, 2));

      return {
        success: true,
        ...object
      };

    } catch (error: any) {
      console.error("❌ LLM Parsing Failed:", error);
      return {
        success: false,
        error: error.message,
        start: null,
        end: null
      };
    }
  },
});
