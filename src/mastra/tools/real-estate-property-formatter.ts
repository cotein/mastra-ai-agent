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
    formattedText: z.string().describe("Requisitos y Mascotas extraídos"),
  }),
  execute: async ({ keywordsZonaProp }) => {
    console.log("   [Tool] 🛠️  Ejecutando extracción técnica...");

    const systemPrompt = `
    # ROL
    Eres un Arquitecto de Datos Inmobiliarios. Tu misión es transformar descripciones desordenadas en datos estructurados de requisitos y mascotas.

    # REGLAS DE ORO
    1. Si no hay mención de mascotas, el campo Mascotas debe ser estrictamente: Sin descripción disponible.
    2. Limpia todo el ruido legal de "medidas aproximadas" o "fotos no vinculantes".
    3. Mantén la literalidad en los requisitos de garantía e ingresos.

    # EJEMPLOS DE APRENDIZAJE
    <examples>
      <example>
        <input>
          "Departamento monoambiente... Alquiler: $390.000 + Expensas. Requisitos: Garantía propietaria con justificación de ingresos de garantes (recibo de sueldo, monotributo, ganancias, etc.). El locatario deberá gestionar un seguro de incendio sobre el inmueble. - Nota importante: Toda la información y medidas provistas son aproximadas..."
        </input>
        <output>
          Requisitos: Garantía propietaria con justificación de ingresos de garantes (recibo de sueldo, monotributo, ganancias, etc.). El locatario deberá gestionar un seguro de incendio sobre el inmueble.
          Mascotas: Sin descripción disponible
        </output>
      </example>

      <example>
        <input>
          "Casa en alquiler... $1.400.000. Requisitos: Garantía propietaria con justificación de ingresos de garantes (recibo de sueldo, monotributo, ganancias, etc.) y seguro de incendio. - Nota importante: Los gastos expresados refieren a la última información recabada..."
        </input>
        <output>
          Requisitos: Garantía propietaria con justificación de ingresos de garantes (recibo de sueldo, monotributo, ganancias, etc.) y seguro de incendio.
          Mascotas: Sin descripción disponible
        </output>
      </example>

      <example>
        <input>
          "Departamento 3 ambientes... NO SE PERMITEN MASCOTAS. SE ENTREGA RECIÉN PINTADO!!! Alquiler: $790.000. Requisitos: Garantía propietaria con justificación de ingresos de inquilinos y garantes (recibo de sueldo, monotributo, ganancias, etc.) y seguro de incendio."
        </input>
        <output>
          Requisitos: Garantía propietaria con justificación de ingresos de inquilinos y garantes (recibo de sueldo, monotributo, ganancias, etc.) y seguro de incendio.
          Mascotas: NO SE PERMITEN MASCOTAS. SE ENTREGA RECIÉN PINTADO!!!
        </output>
      </example>
    </examples>

    # FORMATO DE RESPUESTA FINAL
    Requisitos: [Texto]
    Mascotas: [Texto o Sin descripción disponible]
    `;

    try {
      const completion = await openai.chat.completions.create({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Extrae los datos de este texto:\n\n${keywordsZonaProp}` },
        ],
        model: "gpt-4o-mini",
        temperature: 0, // Determinismo puro para extracción de datos
      });

      return {
        formattedText: completion.choices[0]?.message?.content || "No se pudo procesar.",
      };
    } catch (error: any) {
      console.error("   [Tool] ❌ Error:", error.message);
      throw new Error("Error en el procesamiento de datos inmobiliarios.");
    }
  },
});