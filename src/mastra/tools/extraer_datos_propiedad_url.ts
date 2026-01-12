import { createTool } from '@mastra/core/tools';
import axios from 'axios';
import { z } from 'zod';

export const apifyScraperTool = createTool({
  id: 'apify-web-scraper',
  description: `Extrae el contenido textual crudo de una URL.`,
  inputSchema: z.object({
    url: z.string().url(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    data: z.array(z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ url }) => {
    const APIFY_TOKEN = process.env.APIFY_TOKEN; 
    // CORRECCIÓN: La API de Apify usa ~ para separar usuario y actor en la URL del endpoint
    const ACTOR_NAME = "apify~website-content-crawler"; 

    if (!APIFY_TOKEN) {
      return { success: false, error: "Falta APIFY_TOKEN en .env" };
    }

    try {
      const response = await axios.post(
        `https://api.apify.com/v2/acts/${ACTOR_NAME}/runs?token=${APIFY_TOKEN}`,
        { startUrls: [{ url }] }
      );

      const runId = response.data.data.id;
      const datasetId = response.data.data.defaultDatasetId;

      let status = "RUNNING";
      while (status === "RUNNING" || status === "READY") {
        await new Promise(r => setTimeout(r, 2000));
        const check = await axios.get(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`);
        status = check.data.data.status;
      }

      const items = await axios.get(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}`);
      
      return {
        success: true,
        data: items.data
      };
    } catch (e: any) {
      const msg = e.response?.data?.error?.message || e.message;
      return { success: false, error: msg };
    }
  },
});