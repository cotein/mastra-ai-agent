import { createTool } from '@mastra/core/tools';
import axios from 'axios';
import { z } from 'zod';
import { PropertyResponse } from '../../types';

// Helper to pause execution
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const tokkoPropertySearchByPriceTool = createTool({
  id: 'tokko-property-search-by-price',
  description: `Busca propiedades en Tokko Broker utilizando un filtro avanzado.`,
  inputSchema: z.object({
    current_localization_id: z.number().default(1),
    current_localization_type: z.string().default("country"),
    price_from: z.number(),
    price_to: z.number(),
    operation_types: z.array(z.number()).default([1, 2, 3]),
    property_types: z.array(z.number()).default([1, 2, 3, 4, 5, 6, 7]),
    currency: z.string().default("USD"),
    filters: z.array(z.tuple([z.string(), z.string(), z.string()])).default([]),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    data: z.custom<PropertyResponse>().optional(),
    error: z.string().optional(),
  }),
  execute: async (params) => {
    const TOKKO_API_KEY = "4b83dbe841cb6d1c70bfbefd87488f07317f623a";
    const BASE_URL = "https://www.tokkobroker.com/api/v1/property/search";

    console.log(`🔎 Searching Tokko for properties between ${params.currency} ${params.price_from} and ${params.currency} ${params.price_to}...`);

    try {
      const dataParam = JSON.stringify(params);
      const response = await axios.get<PropertyResponse>(BASE_URL, {
        params: {
          limit: 20,
          data: dataParam,
          key: TOKKO_API_KEY,
          lang: 'es_ar',
          format: 'json',
        },
      });

      const objectsFound = response.data.objects?.length || 0;
      console.log(`✅ Search completed: ${objectsFound} properties found.`);

      return {
        success: true,
        data: response.data,
      };

    } catch (e: any) {
      const msg = e.response?.data?.error_message || e.message;
      console.error(`❌ Error searching for properties:`, msg);
      return { success: false, error: msg };
    }
  },
});
