// src/mastra/tools/real-estate-property-formatter.ts
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import OpenAI from "openai"; // Usamos el driver oficial

// Instanciamos el cliente fuera del execute para reutilizar conexión si es posible
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const realEstatePropertyFormatterTool = createTool({
  id: "real-estate-property-formatter",
  description: "Limpia, extrae y formatea información técnica de descripciones inmobiliarias.",
  inputSchema: z.object({
    keywordsZonaProp: z.string().describe("El texto bruto de la descripción de la propiedad"),
  }),
  outputSchema: z.object({
    formattedText: z.string().describe("El listado formateado y coherente"),
  }),
  execute: async ({ keywordsZonaProp }) => {
    console.log("   [Tool] 🛠️  Conectando directo con API OpenAI (gpt-4o-mini)...");

    const systemPrompt = `Eres un motor de extracción de datos técnicos inmobiliarios. 
    Tu única tarea es extraer y limpiar los datos.
    
    Campos a extraer:
    - Tipo
    - Operación
    - Ubicación (Barrio, Localidad)
    - Superficie (solo números y unidad)
    - Ambientes (cantidad)

    Reglas de Salida ESTRICTAS:
    1. Devuelve SOLO la lista de datos. NADA de texto introductorio ("Aquí tienes", "Revisando").
    2. NO uses Markdown (ni negritas **, ni bloques, ni guiones -).
    3. NO repitas información.
    4. Formato: "Campo: Valor".`;

    const userPrompt = `Procesa este texto raw: "${keywordsZonaProp}"`;

    try {
      const completion = await openai.chat.completions.create({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        model: "gpt-4o-mini",
        temperature: 0.1,
      });

      const text = completion.choices[0]?.message?.content || "No se pudo generar texto";

      console.log("   [Tool] ✅ Respuesta recibida (Tokens usados: " + completion.usage?.total_tokens + ")");
      
      return {
        formattedText: text,
      };
    } catch (error: any) {
      console.error("   [Tool] ❌ Error Nativo OpenAI:", error.message);
      
      // Si es un error 429 (Rate Limit), lo relanzamos para que el Workflow lo capture
      if (error.status === 429) {
        throw new Error("rate_limit_exceeded"); 
      }
      throw error;
    }
  },
});