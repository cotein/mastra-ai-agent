
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { PropertyResponse, Location } from '../../types';

export const formatPropertyDataTool = createTool({
  id: 'format-property-data',
  description: 'Formats property data from Tokko search results to a simplified structure.',
  inputSchema: z.object({
    success: z.boolean(),
    data: z.custom<PropertyResponse>(),
    error: z.string().optional(),
  }),
  outputSchema: z.object({
    address: z.string(),
    description: z.string(),
    operations: z.array(z.object({
      prices: z.array(z.object({
        price: z.number(),
        currency: z.string(),
      })),
      operation_type: z.string(),
    })),
    location: z.custom<Location>(),
  }),
  execute: async (input) => {
    if (!input.success || !input.data || !input.data.objects || input.data.objects.length === 0) {
      throw new Error('No property data found to format.');
    }

    const property = input.data.objects[0];

    // Filter for "Venta" operations as requested, or return all if none match (fallback)
    let operations = property.operations.filter(op => op.operation_type === 'Venta');
    
    if (operations.length === 0 && property.operations.length > 0) {
        operations = property.operations;
    }

    const simpleOperations = operations.map(op => ({
        prices: op.prices.map(p => ({ price: p.price, currency: p.currency })),
        operation_type: op.operation_type
    }));

    return {
      address: property.address,
      description: property.description || property.description_only || '',
      operations: simpleOperations,
      location: property.location,
    };
  },
});
