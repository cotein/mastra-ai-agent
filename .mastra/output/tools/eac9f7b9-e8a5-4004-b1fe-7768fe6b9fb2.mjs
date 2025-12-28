import { createTool } from '@mastra/core/tools';
import axios from 'axios';
import { z } from 'zod';

const apifyScraperTool = createTool({
  id: "apify-web-scraper",
  description: "Scrapea sitios web complejos y devuelve el contenido en Markdown usando Apify.",
  inputSchema: z.object({
    url: z.string().url().describe("La URL de la propiedad o sitio a scrapear")
  }),
  execute: async (input) => {
    const APIFY_TOKEN = process.env.APIFY_TOKEN;
    if (!APIFY_TOKEN) {
      throw new Error("APIFY_TOKEN is missing in environment variables");
    }
    const ACTOR_ID = "aYG0l9s7dbB7j3gbS";
    const payload = {
      startUrls: [{ url: input.url, method: "GET" }],
      crawlerType: "playwright:adaptive",
      proxyConfiguration: {
        useApifyProxy: true,
        apifyProxyGroups: ["RESIDENTIAL"],
        apifyProxyCountry: "AR"
      },
      saveMarkdown: true,
      removeCookieWarnings: true,
      htmlTransformer: "readableText",
      useStealth: true
    };
    try {
      const runResponse = await axios.post(
        `https://api.apify.com/v2/acts/${ACTOR_ID}/runs`,
        payload,
        { headers: { Authorization: `Bearer ${APIFY_TOKEN}` } }
      );
      const runId = runResponse.data.data.id;
      let status = runResponse.data.data.status;
      let defaultDatasetId = "";
      console.log(`Job iniciado: ${runId}. Esperando finalizaci\xF3n...`);
      while (status !== "SUCCEEDED" && status !== "FAILED" && status !== "ABORTED") {
        await new Promise((resolve) => setTimeout(resolve, 1e4));
        const checkResponse = await axios.get(
          `https://api.apify.com/v2/actor-runs/${runId}`,
          { headers: { Authorization: `Bearer ${APIFY_TOKEN}` } }
        );
        status = checkResponse.data.data.status;
        if (status === "SUCCEEDED") {
          defaultDatasetId = checkResponse.data.data.defaultDatasetId;
        }
      }
      if (status !== "SUCCEEDED") {
        throw new Error(`El actor de Apify fall\xF3 con estatus: ${status}`);
      }
      const datasetResponse = await axios.get(
        `https://api.apify.com/v2/datasets/${defaultDatasetId}/items`,
        { headers: { Authorization: `Bearer ${APIFY_TOKEN}` } }
      );
      return {
        markdown: datasetResponse.data[0]?.markdown || "No se pudo generar Markdown",
        fullData: datasetResponse.data[0]
      };
    } catch (error) {
      console.error("Error en Apify Tool:", error);
      throw error;
    }
  }
});

export { apifyScraperTool };
