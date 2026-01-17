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
  execute: async ({ rawData }) => {
    // Tomamos el primer elemento del array, similar a lo que hacía el usuario en su ejemplo
    const dataItem = rawData[0];

    if (!dataItem) {
      return { operacionTipo: "" as const };
    }

    const metadata = dataItem.metadata || {};
    const keywords = metadata.keywords;
    const text = metadata.text;

    let addressLocality: string | undefined;
    let streetAddress: string | undefined;
    let operacionTipo: string | undefined;
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


    if (keywords) {
      const upperKeywords = keywords.toUpperCase();
      if (upperKeywords.includes("ALQUILAR") || upperKeywords.includes("ALQUILER") || upperKeywords.includes("ALQUILA")) {
        operacionTipo = "ALQUILAR";
      } else if (upperKeywords.includes("VENDER") || upperKeywords.includes("VENTA") || upperKeywords.includes("COMPRA")) {
        operacionTipo = "VENDER";
      } else {
        operacionTipo = "";
      }
    } else {
      operacionTipo = "";
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
