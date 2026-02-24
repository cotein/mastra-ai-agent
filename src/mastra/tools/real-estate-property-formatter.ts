// src/mastra/tools/real-estate-property-formatter.ts
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const realEstatePropertyFormatterTool = createTool({
  id: "real-estate-property-formatter",
  description: "Extrae requisitos y política de mascotas de descripciones inmobiliarias usando Few-Shot estructural.",
  inputSchema: z.object({
    keywordsZonaProp: z.string().describe("Descripción bruta de la propiedad"),
  }),
  outputSchema: z.object({
    requisitos: z.string().describe("Requisitos de la propiedad"),
    mascotas: z.string().describe("Política de mascotas"),
  }),
  execute: async ({ keywordsZonaProp }, _context) => {
    console.log("   [Tool] 🛠️  Ejecutando extracción técnica...");

    const systemPrompt = `
    # ROL
    Eres un Arquitecto de Datos Inmobiliarios. Tu misión es transformar descripciones desordenadas en datos estructurados de requisitos y mascotas.

    # REGLAS DE ORO
    1. Si no hay mención de mascotas, no hagas mención de mascotas.
    2. Limpia todo el ruido legal de "medidas aproximadas" o "fotos no vinculantes".
    3. Mantén la literalidad en los requisitos de garantía e ingresos.

    # FORMATO DE SALIDA (JSON)
    Responde ÚNICAMENTE con un objeto JSON válido con las siguientes claves:
    - requisitos: Texto con los requisitos de garantía, ingresos, etc.
    - mascotas: Texto con la política de mascotas o cadena vacía si no se menciona.
    `;

    try {
      const completion = await openai.chat.completions.create({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Extrae los datos de este texto:\n\n${keywordsZonaProp}` },
        ],
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
      });

      const content = completion.choices[0]?.message?.content || "{}";
      const result = JSON.parse(content);

      return {
        requisitos: result.requisitos || "No especificado",
        mascotas: result.mascotas || "",
      };
    } catch (error: any) {
      console.error("   [Tool] ❌ Error:", error.message);
      throw new Error("Error en el procesamiento de datos inmobiliarios.");
    }
  },
});