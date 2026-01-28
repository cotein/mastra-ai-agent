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
  description: "Limpia, extrae y formatea información de descripciones inmobiliarias.",
  inputSchema: z.object({
    keywordsZonaProp: z.string().describe("El texto bruto de la descripción de la propiedad"),
  }),
  outputSchema: z.object({
    formattedText: z.string().describe("El listado formateado y coherente"),
  }),
  execute: async ({ keywordsZonaProp }) => {
    console.log("   [Tool] 🛠️  Conectando directo con API OpenAI (gpt-4o-mini)...");

    const systemPrompt = `Eres un motor de extracción de datos técnicos inmobiliarios de Alta Precisión.
    Analiza el texto desordenado y extrae la siguiente información estructurada.
    
    ### CAMPOS A EXTRAER:
    1. **Tipo Operación**: (Alquiler, Venta o Temporal).
    2. **Domicilio**: Localidad y Domicilio (Ej: "CABA, Av. del Libertador 1234" o "Monte Grande, Fray Luis Beltrán 1234"). Limpia nombres de inmobiliarias y centrate en conseguir el domicilio.
    3. **Superficie**: Prioriza Metros Totales y Cubiertos (Ej: "800m² Totales / 200m² Cubiertos").
    4. **Ambientes**: Cantidad de ambientes y dormitorios.
    5. **Requisitos**: Extrae TODOS los requisitos completos y literales. Incluye garantías (Propietaria, Caución), recibos de sueldo, depósitos, mes de adelanto y gastos. No resumas. Si no hay info explícita, pon "Consultar".
    6. **Mascotas**: Busca "Acepta mascotas", "No acepta mascotas" o íconos. Si no dice nada, pon "A confirmar".
    7. **Precio**: Moneda y Valor (Ej: "USD 2.100").
    8. **Expensas**: Si figuran.

    ### REGLAS DE LIMPIEZA:
    - Ignora textos de publicidad como "Garantías 100% online", "Avisarme si baja", etc, salvo que sirvan para deducir requisitos.
    - Si hay datos contradictorios (ej: 4 amb y 6 amb), usa el más específico o el que aparezca en la descripción técnica.

    ### FORMATO DE SALIDA (Texto Plano):
    Operación: [Valor]
    Domicilio: [Valor]
    Superficie: [Valor]
    Ambientes: [Valor]
    Precio: [Valor]
    Requisitos: [Valor]
    Mascotas: [Valor]
    `;

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
      console.log("   [Tool] 📦 DATA EXTRAÍDA:\n", text);
      
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