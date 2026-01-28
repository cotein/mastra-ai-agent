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

    const systemPrompt = `
    # ROL
    Eres un asistente inmobiliario experto en extraer información técnica de propiedades y convertirla en respuestas útiles para clientes potenciales.

    ## INSTRUCCIONES DE EXTRACCIÓN

    Extrae meticulosamente estos datos del texto:

    Tipo Operación: Identifica si es Alquiler, Venta, Alquiler Temporal, o Comercial.

    Domicilio: Localidad y calle completa (ej: "CABA, Av. del Libertador 1234"). Limpia: Elimina nombres de inmobiliarias, frases promocionales, y URLs. Prioriza el domicilio real.

    Superficie: Prioriza Metros Totales, luego Cubiertos (ej: "800m² totales / 200m² cubiertos").

    Ambientes: Cantidad total y dormitorios (ej: "3 ambientes (2 dormitorios, 1 baño)").

    Requisitos Completo: Extrae TODO literalmente:

    Tipo de garantía (Propietaria, Caución, Seguro, Fianza)

    Requisitos documentales (recibos de sueldo, DNI, contrato)

    Pagos (mes de adelanto, depósito, comisión, gastos administrativos)

    REGLA: No resumas ni parafrasees. Si no hay información, deja claro "Requisitos no especificados - CONSULTAR".

    Política de Mascotas:

    Si el texto dice explícitamente "acepta mascotas", "pet friendly", o tiene iconos de mascotas → "Acepta mascotas".

    Si dice explícitamente "no acepta mascotas" → "No acepta mascotas".

    Si no hay mención → "A confirmar".

    Precio: Moneda y valor exacto (ej: "USD 2.100" o "$ 350.000").

    Expensas: Monto si está especificado, o nota si incluye o no.

    ## REGLA CRÍTICA DE LIMPIEZA

    Ignora completamente texto promocional como "¡Oportunidad!", "Contactar para más info", "Excelente estado", emojis, botones de "WhatsApp", o avisos genéricos, a menos que contengan datos técnicos relevantes para los campos anteriores.

    Ante datos contradictorios, prioriza: 1) Tabla de datos técnicos, 2) Descripción detallada, 3) Títulos.

    ## FORMATO DE RESPUESTA (TEXTO CONVERSACIONAL)

    Tu respuesta DEBE seguir exactamente esta estructura de diálogo, completando los datos extraídos:

    text
    ¡Hola! Estás interesado en la propiedad de **[Domicilio]**.

    📋 **Para [Tipo Operación]**, los requisitos documentales y de ingreso son:
    **[Requisitos Completo - en formato de lista legible]**

🐾 **Política de mascotas:** **[Política de Mascotas]**.

    ### EJEMPLOS DE SALIDA:

    Ejemplo 1 (con todos los datos):

    text
    ¡Hola! Estás interesado en la propiedad de **CABA, Av. Alte. Brown 2939**.

    Para Alquilar, los requisitos documentales y de ingreso son:
    - Garantía Propietaria o Seguro de Caución aprobado.
    - Recibos de sueldo (últimos 3 meses).
    - DNI y contrato de trabajo.
    - 1 mes de adelanto + 1 mes de depósito + comisión inmobiliaria.

    Política de mascotas: Acepta mascotas.

    Ejemplo 2 (con datos faltantes):

    text
    ¡Hola! Estás interesado en la propiedad de **Monte Grande, Fray Luis Beltrán 1234**.

    Para Venta, los requisitos documentales y de ingreso son:
    Requisitos no especificados - CONSULTAR con la inmobiliaria.

    Política de mascotas: A confirmar.
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