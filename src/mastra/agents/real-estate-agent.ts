import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { openai } from "@ai-sdk/openai"; 
import { storage, vectorStore } from './../storage'; 
import { TokenLimiter, ToolCallFilter, PromptInjectionDetector, ModerationProcessor, SystemPromptScrubber } from "@mastra/core/processors";
import { WhatsAppStyleProcessor } from "../processors/whatsapp-style-processor";
import { OperacionTipo } from "./../../types";
// Herramientas
import { calendarManagerTools } from '../tools/google-calendar';
import { gmailManagerTools } from '../tools/google-gmail';
import { potentialSaleEmailTool, alertaAvisoVentaTool } from '../tools/index';

// Prompt de respaldo
const DEFAULT_SYSTEM_PROMPT = `Eres un asistente inmobiliario de Mastra. Esperando instrucciones de contexto...`;

const commonTools = {
    ...calendarManagerTools, 
    ...gmailManagerTools,
};
const salesTools = {
    potential_sale_email: potentialSaleEmailTool, // Solo para ventas
    alerta_aviso_venta: alertaAvisoVentaTool,
};

export const getRealEstateAgent = async (userId: string, instructionsInjected?: string, operacionTipo?: OperacionTipo) => {
  
  // CONFIGURACIÓN DE MEMORIA
  const memory = new Memory({
    storage,
    vector: vectorStore,
    embedder: openai.embedding("text-embedding-3-small"),
    options: {
      lastMessages: 22,
      semanticRecall: { 
        topK: 3, 
        messageRange: 3,
      },
      workingMemory: {
        enabled: true,
        scope: "resource",
        template: `# User Profile
          - **First Name**:
          - **Last Name**:
          - **Email**:
          - **Phone**:
          - **Location**:
          - **Budget Max**:
          - **Preferred Zone**:
          - **Property Type Interest**: (Casa/Depto/PH)
          - **Consulted Properties History**: (List of URLs or addresses recently discussed or scraped)
          `,
      },
      generateTitle: true,
    },
  });

  const finalInstructions = instructionsInjected || DEFAULT_SYSTEM_PROMPT;

  let selectedTools = { ...commonTools };
  if (operacionTipo === 'ALQUILAR') {
      selectedTools = { ...selectedTools };
  } else if (operacionTipo === 'VENDER') {
      selectedTools = { ...selectedTools, ...salesTools };
  } else {
      // Caso default (quizás solo herramientas de consulta)
      selectedTools = { ...selectedTools }; 
  }
  console.log('#'.repeat(50) + ' REAL ESTATE AGENT ' + '#'.repeat(50));
  console.log(finalInstructions);
  console.log('#'.repeat(50));
  return new Agent({
    // ID obligatorio para Mastra
    id: "real-estate-agent", 
    name: "Real Estate Agent",
    instructions: finalInstructions,
    model: openai('gpt-4o'), 
    memory,
    tools: selectedTools,
    inputProcessors: [
        new PromptInjectionDetector({
          model: openai('gpt-4o-mini'),
          threshold: 0.8,
          strategy: 'block',
        }),
        new ModerationProcessor({
            model: openai('gpt-4o-mini'),
            threshold: 0.7,
            strategy: 'block', 
        }),
        new TokenLimiter(3000), 
    ],
    outputProcessors: [
       new SystemPromptScrubber({
         model: openai('gpt-4o-mini'),
         strategy: 'redact',
         redactionMethod: 'placeholder',
       }),
       new WhatsAppStyleProcessor(),
    ],
  });
};