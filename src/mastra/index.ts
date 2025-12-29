import 'dotenv/config';
// Polyfill crypto for Node environment if missing
if (!global.crypto) {
    global.crypto = require('crypto');
}
import { Mastra } from "@mastra/core";
import { getRealEstateAgent } from "./agents/real-estate-agent";
import { PostgresStore } from "@mastra/pg";
import { nicoBookingWorkflow } from './workflows/booking';
import { ingestionWorkflow } from './workflows/ingesta';

const realEstateAgent = await getRealEstateAgent('placeholder-system');

// Determinar el storage
const storage = process.env.POSTGRES_URL 
  ? new PostgresStore({
      id: 'pg-store',
      connectionString: process.env.POSTGRES_URL,
      // Eliminamos tableName para que Mastra use su esquema estándar 
      // y se mapee correctamente a tus tablas mastra_threads, mastra_messages, etc.
    })
  : undefined; 

if (!storage) {
  console.warn("⚠️ POSTGRES_URL missing. Using In-Memory storage (Non-persistent).");
}

export const mastra = new Mastra({
  storage,  
  agents: { realEstateAgent }, 
  workflows: { nicoBookingWorkflow, ingestionWorkflow },
});