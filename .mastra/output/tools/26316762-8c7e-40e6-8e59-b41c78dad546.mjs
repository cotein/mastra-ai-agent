import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const propertyDataProcessorTool = createTool({
  id: "property-data-processor",
  description: "Procesa los datos crudos de una propiedad (JSON) y extrae keywords, localidad y direcci\xF3n.",
  inputSchema: z.object({
    rawData: z.array(z.any())
    // Recibe el array de objetos que retorna el scraper
  }),
  outputSchema: z.object({
    keywords: z.string().optional(),
    addressLocality: z.string().optional(),
    streetAddress: z.string().optional(),
    operacionTipo: z.enum(["ALQUILAR", "VENDER", ""])
  }),
  execute: async ({ rawData }) => {
    const dataItem = rawData[0];
    if (!dataItem) {
      return { operacionTipo: "" };
    }
    const metadata = dataItem.metadata || {};
    const keywords = metadata.keywords;
    let addressLocality;
    let streetAddress;
    let operacionTipo;
    if (metadata.jsonLd && Array.isArray(metadata.jsonLd)) {
      const itemWithAddress = metadata.jsonLd.find((item) => item?.address);
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
      operacionTipo
    };
  }
});

export { propertyDataProcessorTool };
