import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { openai } from "@ai-sdk/openai"; 
import { storage, vectorStore } from './../storage'; 
import { TokenLimiter, ToolCallFilter, PromptInjectionDetector, ModerationProcessor, SystemPromptScrubber } from "@mastra/core/processors";
import { WhatsAppStyleProcessor } from "../processors/whatsapp-style-processor";
import { OperacionTipo } from "./../../types";
// Herramientas
import { 
  createCalendarEvent, 
  listCalendarEvents, 
  getCalendarEvent, 
  updateCalendarEvent, 
  deleteCalendarEvent, 
  getAvailableSlots,
  findEventByNaturalDate
} from '../tools/google-calendar';
import { sendEmail, listEmails } from '../tools/google-gmail';
import { potentialSaleEmailTool } from '../tools/index';

// Prompt de respaldo
const DEFAULT_SYSTEM_PROMPT = `Eres un asistente inmobiliario de Mastra. Esperando instrucciones de contexto...`;

const commonTools = {
    createCalendarEvent,
    listCalendarEvents,
    getCalendarEvent,
    updateCalendarEvent,
    deleteCalendarEvent,
    findEventByNaturalDate,
    sendEmail,
    listEmails,
};
const salesTools = {
    potential_sale_email: potentialSaleEmailTool, // Solo para ventas
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

  const selectedTools = operacionTipo === 'ALQUILAR' 
    ? { get_available_slots: getAvailableSlots, create_calendar_event: createCalendarEvent }
    : operacionTipo === 'VENDER'
    ? { potential_sale_email: potentialSaleEmailTool }
    : { };

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