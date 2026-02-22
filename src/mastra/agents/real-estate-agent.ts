import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { openai } from "@ai-sdk/openai"; 
import { storage, vectorStore } from './../storage'; 
import { TokenLimiter, PromptInjectionDetector, ModerationProcessor, SystemPromptScrubber } from "@mastra/core/processors";
import { WhatsAppStyleProcessor } from "../processors/whatsapp-style-processor";
import { OperacionTipo } from "./../../types";
// Para la versión estándar basada en LLM
import { createFaithfulnessScorer } from "@mastra/evals/scorers/prebuilt";
import { z } from "zod";

// Herramientas
import { 
  createCalendarEvent, 
  updateCalendarEvent, 
  deleteCalendarEvent, 
  getAvailableSlots,
  findEventByNaturalDate,
  getAvailableSchedule,
} from '../tools/google-calendar';
import { potentialSaleEmailTool } from '../tools/index';

import { notificarEquipoTool } from '../tools/notificar_equipo';

// Prompt de respaldo
const DEFAULT_SYSTEM_PROMPT = `Eres un asistente inmobiliario de Mastra. Esperando instrucciones de contexto...`;

const faithfulnessScorer = createFaithfulnessScorer({
  model: openai("gpt-4o-mini"), // Modelo utilizado como "juez"
});

export const getRealEstateAgent = async (userId: string, instructionsInjected?: string, operacionTipo?: OperacionTipo) => {
  
  const memory = new Memory({
    storage,
    vector: vectorStore,
    embedder: openai.embedding("text-embedding-3-small"),
    options: {
      lastMessages: 10, // Lo reducimos porque la memoria observacional se encarga del resto
      observationalMemory: {
        model: openai("gpt-4o-mini"), 
        observation: {
          messageTokens: 30000, 
        },
        reflection: {
          observationTokens: 40000, 
        }
      },
      semanticRecall: { 
        topK: 3, 
        messageRange: 3,
      },
      workingMemory: {
        enabled: true,
        scope: "resource",
        schema: z.object({
          firstName: z.string().optional(),
          lastName: z.string().optional(),
          email: z.string().optional(),
          phone: z.string().optional(),
          location: z.string().optional(),
          budgetMax: z.string().optional(),
          preferredZone: z.string().optional(),
          propertyTypeInterest: z.string().describe("Casa/Depto/PH").optional(),
          operacionTipo: z.string().describe("Venta o Alquiler").optional(), // <-- Tu antiguo Map
          propiedadInfo: z.string().optional(), // <-- Tu antiguo Map
          consultedPropertiesHistory: z.array(z.string()).describe("URLs or addresses").optional()
        })
      },
      generateTitle: true,
    },
});

  const finalInstructions = instructionsInjected || DEFAULT_SYSTEM_PROMPT;

  const op = (operacionTipo || '').trim().toUpperCase();
  const selectedTools: any = op === 'ALQUILAR' 
    ? { get_available_slots: getAvailableSlots, create_calendar_event: createCalendarEvent, find_event_by_natural_date: findEventByNaturalDate, update_calendar_event: updateCalendarEvent, delete_calendar_event: deleteCalendarEvent, get_available_schedule: getAvailableSchedule, notificar_equipo: notificarEquipoTool }
    : op === 'VENDER'
    ? { potential_sale_email: potentialSaleEmailTool }
    : { };

  console.log('#'.repeat(50) + ' REAL ESTATE AGENT ' + '#'.repeat(50));
  console.log(finalInstructions);
  console.log('#'.repeat(50));
  console.log('');
  console.log('='.repeat(50));
  
  console.log('🛠️ TOOLS ACTIVAS:', Object.keys(selectedTools));
  console.log('='.repeat(50));

  return new Agent({
    // ID obligatorio para Mastra
    id: "real-estate-agent", 
    name: "Real Estate Agent",
    instructions: finalInstructions,
    model: openai('gpt-4o'), 
    scorers: {
      fidelidad: {
        scorer: faithfulnessScorer,
        // sampling rate: 1 = evalúa el 100% de las respuestas
        sampling: { type: "ratio", rate: 1 },
      },
    },
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