import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { apifyScraperTool } from './tools/eac9f7b9-e8a5-4004-b1fe-7768fe6b9fb2.mjs';
import { createTool } from '@mastra/core/tools';

const scrapeStep = createStep({
  id: "scrape-property-step",
  inputSchema: z.object({
    url: z.string().url()
  }),
  outputSchema: z.object({
    markdown: z.string(),
    url: z.string()
  }),
  execute: async ({ inputData }) => {
    const result = await apifyScraperTool.execute({
      url: inputData.url
    });
    if (!result.markdown) {
      throw new Error("No se obtuvo contenido de la web");
    }
    return {
      markdown: result.markdown,
      url: inputData.url
    };
  }
});
const persistStep = createStep({
  id: "persist-property-step",
  inputSchema: z.object({
    markdown: z.string(),
    url: z.string()
  }),
  outputSchema: z.object({
    status: z.string(),
    propertyUrl: z.string()
  }),
  execute: async ({ getStepResult, mastra }) => {
    const scrapedData = getStepResult("scrape-property-step");
    if (!scrapedData) throw new Error("No hay datos del scraper");
    const cleanContent = scrapedData.markdown.split("Preguntas para la inmobiliaria")[0].trim();
    const embedding = await mastra.embed(cleanContent, {
      provider: "OPENAI",
      model: "text-embedding-3-small"
    });
    const storage = mastra.storage;
    const db = await storage.getPg6();
    await db.none(
      `INSERT INTO public.property_memory (content, embedding, metadata) 
       VALUES ($1, $2, $3)
       ON CONFLICT ((metadata->>'url')) 
       DO UPDATE SET 
          content = EXCLUDED.content, 
          embedding = EXCLUDED.embedding,
          metadata = EXCLUDED.metadata`,
      [
        cleanContent,
        `[${embedding.join(",")}]`,
        JSON.stringify({
          url: scrapedData.url,
          updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
          source: "automated-workflow"
        })
      ]
    );
    return {
      status: "success",
      propertyUrl: scrapedData.url
    };
  }
});
const ingestionWorkflow = createWorkflow({
  id: "ingesta-propiedades-v3",
  inputSchema: z.object({
    url: z.string().url()
  }),
  outputSchema: z.object({
    status: z.string(),
    propertyUrl: z.string()
  })
}).then(scrapeStep).then(persistStep).commit();

const procesarNuevaPropiedad = createTool({
  id: "procesar_propiedad_link",
  description: "Cuando el cliente env\xEDa un link, usa esta herramienta para analizarlo y guardarlo en el sistema.",
  inputSchema: z.object({
    url: z.string().url()
  }),
  execute: async (input) => {
    try {
      const run = await ingestionWorkflow.execute({
        triggerData: { url: input.url }
        // Cambiamos inputData por triggerData
      });
      return {
        resultado: "Propiedad analizada y guardada con \xE9xito",
        detalles: run
        // Mastra guarda los resultados en .results
      };
    } catch (error) {
      console.error("Error ejecutando workflow de ingesta:", error);
      return {
        resultado: "Error al procesar la propiedad",
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
});

export { ingestionWorkflow as i, procesarNuevaPropiedad as p };
