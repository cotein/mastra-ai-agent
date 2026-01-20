import 'dotenv/config';
import { Mastra } from "@mastra/core";
import { registerApiRoute } from "@mastra/core/server";
import axios from "axios";


// Agentes y Herramientas
import { getRealEstateAgent } from "./agents/real-estate-agent"; 
import { realEstateCleaningAgent } from "./agents/real-estate-cleaning-agent";
import { realEstatePropertyFormatterTool } from "./tools/real-estate-property-formatter";

// Storage y Servicios
import { storage, vectorStore, ThreadContextService } from './storage'; 

// Prompts y Helpers
//import { dynamicInstructions } from '../prompts/fausti-prompts';

import { ClientData, OperacionTipo } from '../types';
// Workflows
import { propertyWorkflow } from "./workflows/scrapper-workflow";
import { sleep } from '../helpers/sleep';

/**
 * INICIALIZACIÓN DE STORAGE
 */
await storage.init();

// Instancia base del agente para el sistema Mastra (registro interno)
const realEstateAgent = await getRealEstateAgent('');
const dynamicInstructions = 'Eres un experto administrador de bienes raíces que puede agendar citas con clientes para ver propiedades. Cuando el cliente solicita una visita ejecuta la herramienta get_available_slots, luego cuando el cliente confirma la fecha y hora de la visita ejecuta la herramienta create_calendar_event'
// Instancias adicionales para Mastra Studio (Testing)
const alquiler = await getRealEstateAgent('test-user', dynamicInstructions, 'ALQUILAR');
//const venta = await getRealEstateAgent('test-user', '', 'VENDER');


// Cache simple para deduplicar requests (TTL 15s)
const activeProcessing = new Set<string>();

// Memoria de sesión para el tipo de operación (Persistencia RAM)
const sessionOperationMap = new Map<string, OperacionTipo>();
const sessionLinkMap = new Map<string, string>();
const sessionPropiedadInfoMap = new Map<string, string>();

export const mastra = new Mastra({
  storage,
  vectors: { vectorStore },
  agents: { alquiler },
  
});
