import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});
const realEstatePropertyFormatterTool = createTool({
  id: "real-estate-property-formatter",
  description: "Limpia, extrae y formatea informaci\xF3n t\xE9cnica de descripciones inmobiliarias.",
  inputSchema: z.object({
    keywordsZonaProp: z.string().describe("El texto bruto de la descripci\xF3n de la propiedad")
  }),
  outputSchema: z.object({
    formattedText: z.string().describe("El listado formateado y coherente")
  }),
  execute: async ({ keywordsZonaProp }) => {
    console.log("   [Tool] \u{1F6E0}\uFE0F  Conectando directo con API OpenAI (gpt-4o-mini)...");
    const systemPrompt = `Eres un motor de extracci\xF3n de datos t\xE9cnicos inmobiliarios. 
    Tu \xFAnica tarea es extraer y limpiar los datos.
    
    Campos a extraer:
    - Tipo
    - Operaci\xF3n
    - Ubicaci\xF3n (Barrio, Localidad)
    - Superficie (solo n\xFAmeros y unidad)
    - Ambientes (cantidad)

    Reglas de Salida ESTRICTAS:
    1. Devuelve SOLO la lista de datos. NADA de texto introductorio ("Aqu\xED tienes", "Revisando").
    2. NO uses Markdown (ni negritas **, ni bloques, ni guiones -).
    3. NO repitas informaci\xF3n.
    4. Formato: "Campo: Valor".`;
    const userPrompt = `Procesa este texto raw: "${keywordsZonaProp}"`;
    try {
      const completion = await openai.chat.completions.create({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        model: "gpt-4o-mini",
        temperature: 0.1
      });
      const text = completion.choices[0]?.message?.content || "No se pudo generar texto";
      console.log("   [Tool] \u2705 Respuesta recibida (Tokens usados: " + completion.usage?.total_tokens + ")");
      return {
        formattedText: text
      };
    } catch (error) {
      console.error("   [Tool] \u274C Error Nativo OpenAI:", error.message);
      if (error.status === 429) {
        throw new Error("rate_limit_exceeded");
      }
      throw error;
    }
  }
});

export { realEstatePropertyFormatterTool };
