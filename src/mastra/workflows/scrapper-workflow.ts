import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { apifyScraperTool } from "../tools/extraer_datos_propiedad_url";
import { realEstatePropertyFormatterTool } from "../tools/real-estate-property-formatter";
import { sleep } from "../../helpers/sleep";
import {propertyDataProcessorTool} from "../tools/property-data-processor";
// 1. Paso de Scrapeo (Simulado o Real)
const scrapeStep = createStep({
  id: "scrapeStep",
  inputSchema: z.object({
    url: z.string().url(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    data: z.any(),
  }),
  execute: async ({ inputData }) => {
    await sleep(1);
    const result = await apifyScraperTool.execute(
      { url: inputData.url },
    );

    if (!("data" in result)) {
      throw new Error("Scraping failed");
    }

    return {
      success: true,
      data: result.data || []
    };
  },
});

// 2. Paso de Formateo 
const extratDataFromScrapperTool = createStep({
  id: "extratDataFromScrapperTool",
  inputSchema: z.object({
    data: z.any(),
  }),
  outputSchema: z.object({
    address: z.string(),
    operacionTipo: z.enum(["ALQUILAR", "VENDER", ""]),
    keywords: z.string(),
    text: z.string(),
  }),
  maxRetries: 2,
  retryDelay: 2500, 
  execute: async ({ inputData, mastra }) => {
    try {
      const result = await propertyDataProcessorTool.execute(
        {rawData: inputData.data},
        { mastra }
      );
      

      if (!("operacionTipo" in result)) {
        throw new Error("Validation failed in propertyDataProcessorTool");
      }

      console.log('>>> INICIO: PASO 2 (Formato)');
      return {
        address: [result.addressLocality, result.streetAddress].filter(Boolean).join(", "),
        operacionTipo: result.operacionTipo, // Guaranteed by the check above
        keywords: result.keywords || "",
        text: result.text || ""
      };
    } catch (error: any) {
      // Si detectamos rate limit, lanzamos error para que el workflow reintente
      if (error.message.includes("rate_limit_exceeded") || error.statusCode === 429) {
        console.warn("⚠️ Rate limit detectado. Reintentando paso...");
      }
      throw error;
    }
  },
});

// 3. Paso de Limpieza (Formatter)
const cleanDataStep = createStep({
  id: "cleanDataStep",
  inputSchema: z.object({
    keywords: z.string(),
    operacionTipo: z.enum(["ALQUILAR", "VENDER", ""]),
    address: z.string(),
    text: z.string(),
  }),
  outputSchema: z.object({
    formattedText: z.string(),
    operacionTipo: z.enum(["ALQUILAR", "VENDER", ""]),
    address: z.string(),
  }),
  execute: async ({ inputData }) => {
    
    // Llamamos a la herramienta de formateo
    const result = await realEstatePropertyFormatterTool.execute({
        keywordsZonaProp: inputData.text
    });

    if (!("formattedText" in result)) {
        throw new Error("Validation failed in realEstatePropertyFormatterTool");
    }

    let finalAddress = inputData.address;
    const finalFormattedText = result.formattedText || inputData.text;

    // Fallback: Si no hay address estructurada, intentar sacarla del texto formateado (LLM)
    if (!finalAddress || finalAddress.trim() === "") {
        const addressMatch = finalFormattedText.match(/Domicilio:\s*(.+)/i);
        if (addressMatch && addressMatch[1]) {
            finalAddress = addressMatch[1].trim();
            console.log("📍 Address recuperada del LLM:", finalAddress);
        }
    }

    return {
      formattedText: finalFormattedText,
      operacionTipo: inputData.operacionTipo,
      address: finalAddress
    };
  },
});

// 4. Paso de Lógica de Negocio
const logicStep = createStep({
  id: "logicStep",
  inputSchema: z.object({
    address: z.string(),
    operacionTipo: z.enum(["ALQUILAR", "VENDER", ""]),
    formattedText: z.string(),
  }),
  outputSchema: z.object({
    minimalDescription: z.string(),
    operacionTipo: z.enum(["ALQUILAR", "VENDER", ""]),
    address: z.string(),
  }),
  execute: async ({ inputData }) => {
    return {
      minimalDescription: inputData.formattedText,
      operacionTipo: inputData.operacionTipo,
      address: inputData.address
    };
  },
});

// Definición y exportación del Workflow
export const propertyWorkflow = createWorkflow({
  id: "property-intelligence-pipeline",
  inputSchema: z.object({
    url: z.string().url(),
  }),
  outputSchema: z.object({
    minimalDescription: z.string(),
    operacionTipo: z.enum(["ALQUILAR", "VENDER", ""]),
    address: z.string(),
  }),
})
  .then(scrapeStep)
  .then(extratDataFromScrapperTool) // output: keywords, address, operacionTipo
  .then(cleanDataStep)              // output: formattedText, address, operacionTipo
  .then(logicStep)                  // output: minimalDescription, address, operacionTipo
  .commit();