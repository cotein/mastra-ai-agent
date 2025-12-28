import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { apifyScraperTool } from '../tools/apify-scrapper-tool';

// PASO 1: Ejecutar el Scraper de Apify
const scrapeStep = createStep({
  id: 'scrape-property-step',
  inputSchema: z.object({
    url: z.string().url(),
  }),
  outputSchema: z.object({
    markdown: z.string(),
    url: z.string(),
  }),
  execute: async ({ inputData }) => {
    // Llamamos a la herramienta que ya tienes definida
    const result = await apifyScraperTool.execute!({
      url: inputData.url,
    });

    if (!result.markdown) {
      throw new Error('No se obtuvo contenido de la web');
    }

    return {
      markdown: result.markdown,
      url: inputData.url,
    };
  },
});

// PASO 2: Procesar, Vectorizar y Guardar en Supabase
const persistStep = createStep({
  id: 'persist-property-step',
  inputSchema: z.object({
    markdown: z.string(),
    url: z.string(),
  }),
  outputSchema: z.object({
    status: z.string(),
    propertyUrl: z.string(),
  }),
  execute: async ({ getStepResult, mastra }: { getStepResult: <T>(id: string) => T | undefined; mastra: any }) => {
    // Recuperamos los datos del paso anterior
    const scrapedData = getStepResult<{ markdown: string; url: string }>('scrape-property-step');
    
    if (!scrapedData) throw new Error('No hay datos del scraper');

    // 1. Limpieza: Nos quedamos solo con la descripción relevante
    const cleanContent = scrapedData.markdown.split('Preguntas para la inmobiliaria')[0].trim();

    // 2. Generar Vector (Embedding)
    const embedding = await mastra.embed(cleanContent, {
      provider: 'OPENAI',
      model: 'text-embedding-3-small',
    });

    // 3. Persistir en la tabla property_memory
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
        `[${embedding.join(',')}]`,
        JSON.stringify({ 
          url: scrapedData.url, 
          updatedAt: new Date().toISOString(),
          source: 'automated-workflow' 
        })
      ]
    );

    return { 
      status: 'success', 
      propertyUrl: scrapedData.url 
    };
  },
});

// DEFINICIÓN DEL WORKFLOW
export const ingestionWorkflow = createWorkflow({
  id: 'ingesta-propiedades-v3',
  inputSchema: z.object({
    url: z.string().url(),
  }),
  outputSchema: z.object({
    status: z.string(),
    propertyUrl: z.string(),
  }),
})
  .then(scrapeStep)
  .then(persistStep)
  .commit();