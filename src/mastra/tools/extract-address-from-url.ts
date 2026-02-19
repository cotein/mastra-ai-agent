import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const extractAddressFromUrlTool = createTool({
  id: 'extract-address-from-url',
  description: `Extrae la dirección postal y estructura el filtro de búsqueda a partir de una URL de Zonaprop utilizando lógica determinística (regex).`,
  inputSchema: z.object({
    url: z.string().url(),
  }),
  outputSchema: z.object({
    filters: z.array(z.tuple([z.string(), z.string(), z.string()])),
    current_localization_type: z.string(),
    current_localization_id: z.number(),
    price_from: z.number(),
    price_to: z.number(),
    operation_types: z.array(z.number()),
    property_types: z.array(z.number()),
  }),
  execute: async ({ url }: { url: string }) => {
    // Valores por defecto
    const result = {
      filters: [] as [string, string, string][],
      current_localization_type: "country",
      current_localization_id: 1,
      price_from: 0,
      price_to: 99999999,
      operation_types: [1, 2, 3],
      property_types: [1, 2, 3, 4, 5, 6, 7, 8],
    };

    try {
      // Lógica de extracción específica para Zonaprop
      // Patrón esperado: .../clasificado/OPERACION-CALLE-NUMERO-ID.html
      
      if (url.includes("zonaprop.com.ar")) {
        // 1. Localizar el segmento clave después de /clasificado/
        const match = url.match(/\/clasificado\/(.+?)-(\d+)\.html/);
        
        if (match) {
            let slug = match[1]; // Ejemplo: vecllcin-av-meeks-158
            
            // 2. Eliminar prefijos conocidos de operación (terminan en 'in-')
            // Ejemplos: vecllcin-, alclapin-, veclcain-
            // Buscamos el primer guión después de un patrón 'in' al inicio
            const prefixMatch = slug.match(/^([a-z]+in-)/);
            if (prefixMatch) {
                slug = slug.replace(prefixMatch[1], "");
            }

            // 3. Reemplazar guiones por espacios
            let address = slug.replace(/-/g, " ");

            // 4. Capitalizar (Title Case)
            address = address.split(" ")
                             .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                             .join(" ");

            // Asignar al filtro
            // Validamos que tenga al menos un número para considerarlo dirección válida con altura
            if (/\d+/.test(address)) {
                result.filters.push(["address", "contains", address]);
            }
        }
      }

      // Si no encontró nada, devuelve el objeto base (sin filtros de dirección), 
      // lo cual es un comportamiento seguro (el siguiente paso de búsqueda fallaría o traería todo).
      return result;

    } catch (e) {
      // En caso de error de parsing, devolvemos el objeto vacío/default
      return result;
    }
  },
});
