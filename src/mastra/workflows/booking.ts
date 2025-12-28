import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

// PASO 1: Scraping (Regla 2 de tu prompt)
const scrapePropertyStep = createStep({
  id: 'scrape-property',
  inputSchema: z.object({ url: z.string().url() }),
  outputSchema: z.object({ details: z.string() }),
  execute: async () => {
    // Aquí llamas a tu lógica de scraping_propiedad
    return { details: "Casa en Lomas, 3 ambientes, USD 120k" };
  },
});

// PASO 2: Proximidad Geográfica (Regla 6 de tu prompt)
const geoProximityStep = createStep({
  id: 'check-proximity',
  inputSchema: z.object({ details: z.string() }),
  outputSchema: z.object({ suggestions: z.array(z.string()) }),
  execute: async () => {
    // Lógica para encontrar_propiedad cerca
    return { suggestions: ["Martes 10:00hs", "Jueves 15:00hs"] };
  },
});

export const nicoBookingWorkflow = createWorkflow({
  id: 'booking-flow',
  inputSchema: z.object({ url: z.string().url() }),
  outputSchema: z.object({ suggestions: z.array(z.string()) }),
})
  .then(scrapePropertyStep)
  .then(geoProximityStep)
  .commit();