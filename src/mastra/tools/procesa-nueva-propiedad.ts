import { ingestionWorkflow } from '../workflows/ingesta';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const procesarNuevaPropiedad = createTool({
  id: 'procesar_propiedad_link',
  description: 'Cuando el cliente envía un link, usa esta herramienta para analizarlo y guardarlo en el sistema.',
  inputSchema: z.object({
    url: z.string().url(),
  }),
  execute: async (input) => { // 1. Agregamos el contexto de mastra
    try {
      // 2. Ejecutamos el workflow correctamente. 
      // El objeto 'triggerData' debe coincidir con el inputSchema del primer paso del workflow.
      const run = await ingestionWorkflow.execute({ 
        triggerData: { url: input.url } // Cambiamos inputData por triggerData
      });
      
      return {
        resultado: "Propiedad analizada y guardada con éxito",
        detalles: run // Mastra guarda los resultados en .results
      };
    } catch (error) {
      console.error("Error ejecutando workflow de ingesta:", error);
      return {
        resultado: "Error al procesar la propiedad",
        error: error instanceof Error ? error.message : String(error)
      };
    }
  },
});