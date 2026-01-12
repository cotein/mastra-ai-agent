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
    console.log('>>> INICIO: PASO 1 (Scraping)');
    console.log(`[Workflow] 🌐 Scrapeando URL: ${inputData.url}`);
    await sleep(3);
    const result = await apifyScraperTool.execute(
      { url: inputData.url },
    );
    console.log('>>> FIN: PASO 1');

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
  }),
  maxRetries: 2,
  retryDelay: 2500, 
  execute: async ({ inputData, mastra }) => {
    try {
      const result = await propertyDataProcessorTool.execute(
        {rawData: inputData.data},
        { mastra }
      );
      
      console.log('>>> DEBUG: propertyDataProcessorTool result:', JSON.stringify(result, null, 2));

      if (!("operacionTipo" in result)) {
        throw new Error("Validation failed in propertyDataProcessorTool");
      }

      console.log('>>> INICIO: PASO 2 (Formato)');
      console.log(result);
      console.log('>>> FIN: PASO 2');
      return {
        address: [result.addressLocality, result.streetAddress].filter(Boolean).join(", "),
        operacionTipo: result.operacionTipo, // Guaranteed by the check above
        keywords: result.keywords || ""
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
  }),
  outputSchema: z.object({
    formattedText: z.string(),
    operacionTipo: z.enum(["ALQUILAR", "VENDER", ""]),
    address: z.string(),
  }),
  execute: async ({ inputData }) => {
    console.log('>>> INICIO: PASO 3 (Limpieza/Formatter)');
    
    // Llamamos a la herramienta de formateo
    const result = await realEstatePropertyFormatterTool.execute({
        keywordsZonaProp: inputData.keywords
    });

    console.log('>>> DEBUG: Formatter result:', result);
    console.log('>>> FIN: PASO 3');

    return {
      formattedText: result.formattedText || inputData.keywords, // Fallback si falla
      operacionTipo: inputData.operacionTipo,
      address: inputData.address
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
    console.log('>>> INICIO: PASO 4 (Logic)');
    
    console.log('>>> FIN: PASO 4');
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