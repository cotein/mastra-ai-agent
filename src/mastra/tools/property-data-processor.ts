import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import{ OperacionTipo } from "../../types";
export const propertyDataProcessorTool = createTool({
  id: "property-data-processor",
  description: "Procesa los datos crudos de una propiedad (JSON) y extrae caracteristicas, requisitos, localidad y dirección.",
  inputSchema: z.object({
    rawData: z.array(z.any()), // Recibe el array de objetos que retorna el scraper
  }),
  outputSchema: z.object({
    keywords: z.string().optional(),
    text: z.string().optional(),
    addressLocality: z.string().optional(),
    streetAddress: z.string().optional(),
    operacionTipo: z.enum(["ALQUILAR", "VENDER", ""]),
  }),
  execute: async (inputData) => {
    const { rawData } = inputData;
    // Tomamos el primer elemento del array, similar a lo que hacía el usuario en su ejemplo
    const dataItem = rawData[0];

    if (!dataItem) {
      return { operacionTipo: "" as const };
    }

    const metadata = dataItem.metadata || {};
    const keywords = metadata.keywords;
    // FIX: Apify 'website-content-crawler' puts text in the root, not metadata
    const text = dataItem.text || dataItem.markdown || metadata.text || "";

    let addressLocality: string | undefined;
    let streetAddress: string | undefined;
    let operacionTipo: OperacionTipo = "";
    // Buscamos en jsonLd
    if (metadata.jsonLd && Array.isArray(metadata.jsonLd)) {
      // Buscamos algún objeto que tenga "address"
      // En el ejemplo del usuario, es el tercer elemento (índice 2), pero es mejor buscarlo dinámicamente o iterar.
      // El usuario pidió específicamente: 
      // 2 metadata -> jsonLd -> address -> addressLocality
      // 3 metadata -> jsonLd -> address -> streetAddress
      
      // Intentamos encontrar el objeto que tenga la estructura de dirección
      const itemWithAddress = metadata.jsonLd.find((item: any) => item?.address);
      
      if (itemWithAddress && itemWithAddress.address) {
        addressLocality = itemWithAddress.address.addressLocality;
        streetAddress = itemWithAddress.address.streetAddress;
      }
    }


    // Helper para detectar tipo
    const detectOperation = (content: string = ""): OperacionTipo | "" => {
      const upper = content.toUpperCase();
      if (upper.includes("ALQUILAR") || upper.includes("ALQUILER") || upper.includes("ALQUILA")) return "ALQUILAR";
      if (upper.includes("VENDER") || upper.includes("VENTA") || upper.includes("VENDE")) return "VENDER";
      return "";
    };

    // 1. Intentar con Keywords (Metadata)
    if (keywords) {
        operacionTipo = detectOperation(keywords);
    }

    // 2. Fallback: Intentar con Título (Metadata)
    if (!operacionTipo && metadata.title) {
        operacionTipo = detectOperation(metadata.title);
    }

    // 3. Fallback: Intentar con Texto completo (Primeros 500 chars para no falsos positivos por 'otros anuncios')
    if (!operacionTipo && text) {
        // Limitamos a los primeros caracteres porque a veces abajo recomiendan "Otras propiedades en Venta"
        operacionTipo = detectOperation(text.substring(0, 500));
    }

    return {
      keywords,
      addressLocality,
      streetAddress,
      operacionTipo,
      text,
    };
  },
});
