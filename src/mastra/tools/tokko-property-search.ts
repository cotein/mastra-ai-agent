import { createTool } from '@mastra/core/tools';
import axios from 'axios';
import { z } from 'zod';
import { PropertyResponse } from '../../types';

// Helper to pause execution
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const tokkoPropertySearchTool = createTool({
  id: 'tokko-property-search',
  description: `Busca propiedades en Tokko Broker utilizando un filtro avanzado.`,
  inputSchema: z.object({
    filters: z.array(z.tuple([z.string(), z.string(), z.string()])),
    current_localization_type: z.string(),
    current_localization_id: z.number(),
    price_from: z.number(),
    price_to: z.number(),
    operation_types: z.array(z.number()),
    property_types: z.array(z.number()),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    data: z.custom<PropertyResponse>().optional(), // Using the imported type
    error: z.string().optional(),
  }),
  execute: async (inputData) => {
    const params = inputData;
    const TOKKO_API_KEY = "4b83dbe841cb6d1c70bfbefd87488f07317f623a"; // Hardcoded as requested
    const BASE_URL = "https://www.tokkobroker.com/api/v1/property/search";

    // Extract address from filters
    let baseAddress = "";
    const addressFilterIndex = params.filters.findIndex(f => f[0] === "address");
    
    if (addressFilterIndex !== -1) {
        baseAddress = params.filters[addressFilterIndex][2];
    }

    // Generate variations logic
    let addressVariations: string[] = [];
    
    if (baseAddress) {
        // Clean base address
        const cleaned = baseAddress.trim();
        
        // 1. Original
        addressVariations.push(cleaned);

        // Regex to split street name and number
        // Assumes format "StreetName Number" or "Street Name Number"
        // Try to capture text part and number part
        const match = cleaned.match(/^(.+?)\s+(\d+)$/);

        if (match) {
            const streetName = match[1].trim(); 
            const number = match[2].trim();

            // 2. Format: "Street N Number" (Capital N)
            addressVariations.push(`${streetName} N ${number}`);
            
            // 3. Format: "Street n Number" (Lowercase n)
            addressVariations.push(`${streetName} n ${number}`);

             // 4. Format: "Street Nº Number" (Symbol)
             addressVariations.push(`${streetName} Nº ${number}`);
        }
        
        // 5. Lowercase original
        const lower = cleaned.toLowerCase();
        if (!addressVariations.includes(lower)) {
            addressVariations.push(lower);
        }

        // 6. Just the street name (lowercase) - risky but requested "magin roca"
        if (match) {
             const streetNameLower = match[1].trim().toLowerCase();
             if (!addressVariations.includes(streetNameLower)) {
                 addressVariations.push(streetNameLower);
             }
        }
        
        // 7. Original Uppercase - just in case
        const upper = cleaned.toUpperCase();
        if (!addressVariations.includes(upper)) {
           addressVariations.push(upper);
        }

    } else {
        // No address filter found, just run once with original params
        addressVariations.push(""); 
    }

    // Logic for execution loop
    let lastResult: { success: boolean; data?: PropertyResponse; error?: string } | null = null;

    for (const addressVariant of addressVariations) {
        // Clone params to avoid mutation issues
        const currentParams = JSON.parse(JSON.stringify(params));
        
        // Update filter if we have a variant and filters exist
        if (addressVariant && currentParams.filters) {
             const idx = currentParams.filters.findIndex((f: any) => f[0] === "address");
             if (idx !== -1) {
                 currentParams.filters[idx][2] = addressVariant;
             }
        }

        console.log(`🔎 Tokko Search attempting address: "${addressVariant}" ...`);

        try {
            const dataParam = JSON.stringify(currentParams);
            const response = await axios.get<PropertyResponse>(BASE_URL, {
                params: {
                limit: 20, // Increased limit as per user example result
                data: dataParam,
                key: TOKKO_API_KEY,
                lang: 'es_ar',
                format: 'json',
                },
            });

            lastResult = {
                success: true,
                data: response.data,
            };

            const objectsFound = response.data.objects?.length || 0;
            
            if (objectsFound > 0) {
                console.log(`✅ MATCH FOUND for address: "${addressVariant}" (${objectsFound} objects)`);
                return lastResult;
            } else {
                console.log(`❌ No match for: "${addressVariant}". Retrying in 3s...`);
            }

        } catch (e: any) {
            const msg = e.response?.data?.error_message || e.message;
            console.error(`❌ Error searching for "${addressVariant}":`, msg);
            lastResult = { success: false, error: msg };
            // Continue to next variation even if error? Yes, maybe it was a bad query format
        }

        // Wait before next attempt, but only if there are more variations left
        if (addressVariations.indexOf(addressVariant) < addressVariations.length - 1) {
            await sleep(3000);
        }
    }

    // If we finished loop without returning, return the last result (likely empty or error)
    return lastResult || { success: false, error: "Unknown error" };
  },
});
