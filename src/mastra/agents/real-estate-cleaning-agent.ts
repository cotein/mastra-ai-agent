import { Agent } from "@mastra/core/agent";
import { openai } from "@ai-sdk/openai";
import { realEstatePropertyFormatterTool } from "../tools/real-estate-property-formatter";

export const realEstateCleaningAgent = new Agent({
  id: "real-estate-cleaning-agent",
  name: "Real Estate Cleaning Agent",
  tools: { realEstatePropertyFormatterTool },
  instructions: `
    Eres un experto en procesamiento de datos inmobiliarios. 
    Tu especialidad es la extracción de entidades desde texto no estructurado.
    Eres obsesivo con la coherencia y la eliminación de duplicados.
    No añades comentarios adicionales, solo devuelves el listado solicitado.  
    El tono debe ser profesional y persuasivo, destacando los beneficios.

    siempre usa la herramienta realEstatePropertyFormatterTool para extraer la información.
  `,
  model: 'openai/gpt-4.1-mini'
});