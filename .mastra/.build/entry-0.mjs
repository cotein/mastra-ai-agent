import 'dotenv/config';
import { Mastra } from '@mastra/core';
import { registerApiRoute } from '@mastra/core/server';
import axios from 'axios';
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { openai as openai$1 } from '@ai-sdk/openai';
import { PostgresStore, PgVector } from '@mastra/pg';
import { Pool } from 'pg';
import { SystemPromptScrubber, PromptInjectionDetector, ModerationProcessor, TokenLimiter } from '@mastra/core/processors';
import { generateText, generateObject } from 'ai';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { google } from 'googleapis';
import { es } from 'chrono-node';
import { isValid, addDays, startOfDay, setHours, setMinutes, setSeconds, setMilliseconds, formatISO } from 'date-fns';
import OpenAI from 'openai';
import { createStep, createWorkflow } from '@mastra/core/workflows';

"use strict";
const connectionString = process.env.SUPABASE_POSTGRES_URL;
if (!connectionString) {
  throw new Error("\u274C SUPABASE_POSTGRES_URL missing");
}
const pool = new Pool({
  connectionString,
  max: 10,
  // Límite conservador para dejar espacio a las instancias de Mastra
  idleTimeoutMillis: 3e4
});
const storage = new PostgresStore({
  id: "pg-store",
  connectionString
});
const vectorStore = new PgVector({
  id: "pg-vector",
  connectionString,
  tableName: "memory_messages",
  columnName: "embedding",
  dims: 1536
});
class ThreadContextService {
  static async getContext(threadId) {
    const client = await pool.connect();
    try {
      const res = await client.query(
        `SELECT metadata FROM mastra_threads WHERE id = $1`,
        [threadId]
      );
      return res.rows[0]?.metadata || {};
    } catch (err) {
      console.error("\u{1F525} Error DB GetContext:", err);
      return {};
    } finally {
      client.release();
    }
  }
  static async updateContext(threadId, resourceId, newClientData) {
    if (!newClientData || Object.keys(newClientData).length === 0) {
      return;
    }
    const client = await pool.connect();
    try {
      const jsonString = JSON.stringify(newClientData);
      const query = `
        INSERT INTO mastra_threads (id, "resourceId", title, metadata, "createdAt", "updatedAt")
        VALUES ($1, $2, 'Nueva Conversaci\xF3n', $3::jsonb, NOW(), NOW())
        ON CONFLICT (id) 
        DO UPDATE SET 
          metadata = COALESCE(mastra_threads.metadata, '{}'::jsonb) || EXCLUDED.metadata,
          "updatedAt" = NOW()
          -- Nota: No tocamos el title en el update para no borrar res\xFAmenes previos
        RETURNING metadata; 
      `;
      const result = await client.query(query, [threadId, resourceId, jsonString]);
    } catch (err) {
      console.error("\u{1F525} [Storage] ERROR CR\xCDTICO AL GUARDAR:", err);
    } finally {
      client.release();
    }
  }
  static async getResourceProfile(resourceId) {
    if (!resourceId) return {};
    const client = await pool.connect();
    try {
      const res = await client.query(
        `SELECT "workingMemory" FROM mastra_resources WHERE id = $1 LIMIT 1`,
        [resourceId]
      );
      const rawText = res.rows[0]?.workingMemory || "";
      if (!rawText) return {};
      const extract = (key) => {
        const regex = new RegExp(`- \\*\\*${key}\\*\\*:\\s*(.*)`, "i");
        const match = rawText.match(regex);
        return match && match[1].trim() ? match[1].trim() : void 0;
      };
      return {
        // Asegúrate que estas keys coincidan con tu Template de Mastra
        nombre: extract("First Name") || extract("Name"),
        // Fallback por si acaso
        apellido: extract("Last Name"),
        email: extract("Email"),
        telefono: extract("Phone") || extract("Tel\xE9fono")
      };
    } catch (err) {
      console.error("\u{1F525} Error leyendo Mastra Resources:", err);
      return {};
    } finally {
      client.release();
    }
  }
  static async clearThreadMessages(threadId) {
    const client = await pool.connect();
    try {
      console.log(`\u{1F9F9} [Storage] Limpiando historial para thread: ${threadId}`);
      await client.query(
        `DELETE FROM mastra_messages WHERE "thread_id" = $1`,
        [threadId]
      );
      console.log(`\u2705 [Storage] Historial eliminado exitosamente.`);
    } catch (err) {
      console.error("\u{1F525} [Storage] Error al limpiar mensajes:", err);
    } finally {
      client.release();
    }
  }
}

"use strict";
class WhatsAppStyleProcessor {
  id = "whatsapp-style-processor";
  name = "whatsapp-style-processor";
  // Mastra parece requerir esto para Output Processors
  async processOutputStep(args) {
    return args;
  }
  // Este método se usa cuando se llama a agent.generate()
  async processOutputResult(args) {
    const lastMessage = args.messages[args.messages.length - 1];
    let textToHumanize = "";
    if (typeof lastMessage.content === "string") {
      textToHumanize = lastMessage.content;
    } else if (Array.isArray(lastMessage.content)) {
      textToHumanize = lastMessage.content.map((c) => c.text || "").join("");
    }
    if (!textToHumanize) return args.messages;
    try {
      const { text } = await generateText({
        model: openai$1("gpt-4o-mini"),
        system: `Eres un experto en comunicaci\xF3n por WhatsApp. 
                     Tu trabajo es reescribir el siguiente mensaje para que suene como un humano escribiendo r\xE1pido en WhatsApp.
                     Reglas:
                     - Usa min\xFAsculas mayormente, pero no fuerces errores ortogr\xE1ficos graves.
                     - IMPORTANTE: Tu objetivo principal es que parezca una conversaci\xF3n natural fluida.
                     - REGLA DE ORO DE SEPARACI\xD3N: Separa CADA idea distinta (saludo, pregunta, informaci\xF3n) con DOBLE SALTO DE L\xCDNEA (

). Esto es CRITICO para que salgan como mensajes separados.
                     
                     Ejemplos:
                     Input: "Hola, soy Nico. Necesito que me pases tus datos."
                     Output: 
                     "hola soy nico \u{1F44B}
                     
                     necesito que me pases tus datos porfa"

                     Input: "\xA1Buen d\xEDa! \xBFEn qu\xE9 puedo ayudarte? Necesito tu nombre."
                     Output:
                     "buen d\xEDa! \u{1F60A}
                     
                     en qu\xE9 puedo ayudarte??
                     
                     necesito tu nombre completo"`,
        prompt: textToHumanize
      });
      lastMessage.content = text;
      return args.messages;
    } catch (error) {
      console.error("Error en WhatsAppStyleProcessor:", error);
      return args.messages;
    }
  }
  // Implementación vacía/passthrough para streaming por si acaso se llama,
  // pero este processor está diseñado para funcionar mejor con generate() (no-streaming)
  // o habría que implementar buffering complejo.
  async processOutputStream(args) {
    return args.part;
  }
  async processInput(args) {
    return args.messages;
  }
}

"use strict";
function naturalDateToISO8601(naturalDate, options = {}) {
  try {
    const config = {
      referenceDate: /* @__PURE__ */ new Date(),
      timezone: "local",
      includeTime: true,
      futureDate: true,
      ...options
    };
    if (!naturalDate || typeof naturalDate !== "string") {
      throw new Error("La fecha debe ser una cadena de texto");
    }
    const normalizedInput = normalizeInput(naturalDate);
    const specificPatternResult = trySpecificPatterns(normalizedInput, config);
    let resultDate;
    if (specificPatternResult) {
      resultDate = specificPatternResult;
    } else {
      const chronoResults = es.parse(normalizedInput, config.referenceDate);
      if (!chronoResults || chronoResults.length === 0) {
        throw new Error(`No se pudo interpretar la fecha: "${naturalDate}"`);
      }
      const parsedResult = chronoResults[0];
      resultDate = parsedResult.start.date();
      if (!parsedResult.start.isCertain("hour") && config.includeTime) {
        resultDate = setDefaultTime(resultDate, config);
      }
    }
    if (!isValid(resultDate)) {
      throw new Error("La fecha resultante no es v\xE1lida");
    }
    if (config.futureDate && resultDate < config.referenceDate) {
      const dayOfWeek = resultDate.getDay();
      const daysToAdd = dayOfWeek >= 0 ? 7 : 0;
      resultDate = addDays(resultDate, daysToAdd);
    }
    const isoDate = formatAccordingToOptions(resultDate, config);
    return {
      isoDate,
      date: resultDate,
      success: true
    };
  } catch (error) {
    return {
      isoDate: "",
      date: /* @__PURE__ */ new Date(NaN),
      success: false,
      error: error instanceof Error ? error.message : "Error desconocido"
    };
  }
}
function normalizeInput(text) {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").replace(/(\d)\s*([ap]\.?\s*m\.?)/gi, "$1$2").replace(/\./g, "").trim();
}
function trySpecificPatterns(text, config) {
  const today = startOfDay(config.referenceDate);
  const weekDaysMap = {
    "lunes": 1,
    "martes": 2,
    "miercoles": 3,
    "jueves": 4,
    "viernes": 5,
    "sabado": 6,
    "domingo": 0,
    "lun": 1,
    "mar": 2,
    "mie": 3,
    "jue": 4,
    "vie": 5,
    "sab": 6,
    "dom": 0
  };
  const relativeDaysMap = {
    "hoy": 0,
    "ahora": 0,
    "manana": 1,
    "ma\xF1ana": 1,
    "pasado manana": 2,
    "pasado ma\xF1ana": 2,
    "ayer": -1,
    "anteayer": -2,
    "ante ayer": -2
  };
  for (const [key, offset] of Object.entries(relativeDaysMap)) {
    if (text === key) {
      return offset === 0 ? new Date(config.referenceDate) : addDays(today, offset);
    }
  }
  for (const [dayName, dayNumber] of Object.entries(weekDaysMap)) {
    if (text === dayName || text === `el ${dayName}`) {
      return getNextWeekday(today, dayNumber, config.futureDate);
    }
  }
  const timePatterns = [
    // Formato: "jueves 22 a las 10" (Día + Número + Hora)
    {
      // Quitamos ^ para permitir texto previo ("dale jueves...")
      pattern: /(?:^|\s)(?:el\s+)?(lunes|martes|miercoles|jueves|viernes|sabado|domingo|lun|mar|mie|jue|vie|sab|dom)\s+(\d{1,2})\s+(?:de\s+[^0-9]+\s+)?(a\s+las?|alas|a\s+la)\s+(\d{1,2})(?::(\d{2}))?\s*([ap]m)?/i,
      handler: (match, today2) => {
        const dayNumber = parseInt(match[2]);
        const hour = parseInt(match[4]);
        const minute = match[5] ? parseInt(match[5]) : 0;
        const ampm = match[6] || "";
        let date = new Date(config.referenceDate);
        const currentDay = date.getDate();
        if (config.futureDate && dayNumber < currentDay) {
          date.setMonth(date.getMonth() + 1);
        }
        date.setDate(dayNumber);
        return setTimeWithAMPM(date, hour, minute, ampm);
      }
    },
    // Formato: "martes a las 10"
    {
      pattern: /(?:^|\s)(?:el\s+)?(lunes|martes|miercoles|jueves|viernes|sabado|domingo|lun|mar|mie|jue|vie|sab|dom)\s+(a\s+las?|alas)\s+(\d{1,2})(?::(\d{2}))?\s*([ap]m)?/i,
      handler: (match, today2) => {
        const dayName = match[1];
        const hour = parseInt(match[3]);
        const minute = match[4] ? parseInt(match[4]) : 0;
        const ampm = match[5] || "";
        const dayNumber = weekDaysMap[dayName];
        let date = getNextWeekday(today2, dayNumber, config.futureDate);
        return setTimeWithAMPM(date, hour, minute, ampm);
      }
    },
    // Formato: "mañana a las 15:30"
    {
      pattern: /(?:^|\s)(hoy|manana|mañana|pasado manana|pasado mañana|ayer|anteayer|ante ayer)\s+(a\s+las?|alas)\s+(\d{1,2})(?::(\d{2}))?\s*([ap]m)?/i,
      handler: (match, today2) => {
        const dayRef = match[1];
        const hour = parseInt(match[3]);
        const minute = match[4] ? parseInt(match[4]) : 0;
        const ampm = match[5] || "";
        const offset = relativeDaysMap[dayRef] || 0;
        let date = offset === 0 ? new Date(config.referenceDate) : addDays(today2, offset);
        return setTimeWithAMPM(date, hour, minute, ampm);
      }
    },
    // Formato: "a las 10" o "a las 10:30"
    {
      pattern: /(?:^|\s)(a\s+las?|alas)\s+(\d{1,2})(?::(\d{2}))?\s*([ap]m)?/i,
      handler: (match, today2) => {
        const hour = parseInt(match[2]);
        const minute = match[3] ? parseInt(match[3]) : 0;
        const ampm = match[4] || "";
        let date = config.futureDate && config.referenceDate.getHours() > hour ? addDays(today2, 1) : new Date(config.referenceDate);
        return setTimeWithAMPM(date, hour, minute, ampm);
      }
    },
    // Formato: "en 3 días a las 14"
    {
      pattern: /en\s+(\d+)\s+d[ií]as?\s+(a\s+las?|alas)\s+(\d{1,2})(?::(\d{2}))?\s*([ap]m)?/i,
      handler: (match, today2) => {
        const days = parseInt(match[1]);
        const hour = parseInt(match[3]);
        const minute = match[4] ? parseInt(match[4]) : 0;
        const ampm = match[5] || "";
        let date = addDays(today2, days);
        return setTimeWithAMPM(date, hour, minute, ampm);
      }
    },
    // Formato: "10 de la mañana" o "2 de la tarde"
    {
      pattern: /(\d{1,2})\s+(de\s+la\s+)?(manana|mañana|tarde|noche)/i,
      handler: (match, today2) => {
        const hour = parseInt(match[1]);
        const period = match[3];
        let adjustedHour = hour;
        if (period === "tarde" && hour < 12) adjustedHour += 12;
        if (period === "noche" && hour < 12) adjustedHour += 12;
        if (period === "manana" || period === "ma\xF1ana") {
          adjustedHour = hour === 12 ? 0 : hour;
        }
        let date = config.futureDate && config.referenceDate.getHours() > adjustedHour ? addDays(today2, 1) : new Date(config.referenceDate);
        return setHours(setMinutes(date, 0), adjustedHour);
      }
    },
    // Formato: "esta tarde" o "esta noche"
    {
      pattern: /(esta|esta misma)\s+(manana|mañana|tarde|noche)/i,
      handler: (match, today2) => {
        const period = match[2];
        const now = config.referenceDate;
        let hour = 0;
        switch (period) {
          case "manana":
          case "ma\xF1ana":
            hour = 9;
            break;
          case "tarde":
            hour = 15;
            break;
          case "noche":
            hour = 20;
            break;
        }
        let date = new Date(now);
        if (now.getHours() > hour) {
          date = addDays(date, 1);
        }
        return setHours(setMinutes(date, 0), hour);
      }
    }
  ];
  for (const { pattern, handler } of timePatterns) {
    const match = text.match(pattern);
    if (match) {
      return handler(match, today);
    }
  }
  return null;
}
function getNextWeekday(fromDate, targetWeekday, futureDate = true) {
  const currentWeekday = fromDate.getDay();
  let daysToAdd = targetWeekday - currentWeekday;
  if (!futureDate && daysToAdd < 0) daysToAdd += 7;
  if (futureDate && daysToAdd <= 0) daysToAdd += 7;
  return addDays(fromDate, daysToAdd);
}
function setTimeWithAMPM(date, hour, minute, ampm) {
  let adjustedHour = hour;
  if (ampm) {
    const isPM = ampm.toLowerCase().startsWith("p");
    if (isPM && hour < 12) adjustedHour += 12;
    if (!isPM && hour === 12) adjustedHour = 0;
  } else if (hour < 12) {
    const now = /* @__PURE__ */ new Date();
    if (now.getHours() >= 12 && hour <= 4) {
      adjustedHour += 12;
    }
  }
  return setHours(setMinutes(setSeconds(setMilliseconds(date, 0), 0), minute), adjustedHour);
}
function setDefaultTime(date, config) {
  if (config.includeTime) {
    const now = config.referenceDate;
    return setHours(
      setMinutes(
        setSeconds(
          setMilliseconds(date, now.getMilliseconds()),
          now.getSeconds()
        ),
        now.getMinutes()
      ),
      now.getHours()
    );
  }
  return setHours(setMinutes(setSeconds(setMilliseconds(date, 0), 0), 0), 0);
}
function formatAccordingToOptions(date, config) {
  if (!config.includeTime) {
    return formatISO(date, { representation: "date" });
  }
  if (config.timezone === "utc") {
    return formatISO(date, { representation: "complete" });
  }
  return formatISO(date);
}
function isNaturalDate(text) {
  if (!text || typeof text !== "string") return false;
  const normalized = normalizeInput(text);
  const dateKeywords = [
    "lunes",
    "martes",
    "miercoles",
    "jueves",
    "viernes",
    "sabado",
    "domingo",
    "hoy",
    "manana",
    "ma\xF1ana",
    "ayer",
    "anteayer",
    "a las",
    "alas",
    "de la",
    "tarde",
    "noche",
    "manana",
    "ma\xF1ana",
    "en",
    "dias",
    "d\xEDas",
    "semana",
    "proximo",
    "pr\xF3ximo",
    "proxima",
    "pr\xF3xima"
  ];
  return dateKeywords.some((keyword) => normalized.includes(keyword));
}
function runExamples() {
  const examples = [
    "martes a las 10",
    "ma\xF1ana a las 15:30",
    "hoy a las 20",
    "viernes a las 9:00",
    "en 2 d\xEDas a las 14",
    "a las 18:30",
    "pasado ma\xF1ana a las 8",
    "ayer a las 23:45",
    "jueves alas 11",
    "10 de la ma\xF1ana",
    "2 de la tarde",
    "esta tarde",
    "el lunes a las 14:30",
    "a las 10 am",
    "a las 3 pm"
  ];
  console.log("=== Ejemplos de conversi\xF3n ===\n");
  examples.forEach((example) => {
    const result2 = naturalDateToISO8601(example);
    console.log(`Entrada: "${example}"`);
    console.log(`Salida:  ${result2.isoDate}`);
    console.log(`\xC9xito:   ${result2.success}`);
    if (result2.error) console.log(`Error:   ${result2.error}`);
    console.log("---");
  });
  console.log("\n=== Con opciones personalizadas ===\n");
  const referenceDate = /* @__PURE__ */ new Date("2024-01-15T12:00:00");
  const result = naturalDateToISO8601("martes a las 10", { referenceDate });
  console.log(`Referencia: ${referenceDate.toISOString()}`);
  console.log(`Entrada: "martes a las 10"`);
  console.log(`Salida:  ${result.isoDate}`);
}

"use strict";
const llmDateParser = createTool({
  id: "llm_date_parser",
  description: 'Parses natural language date/time expressions into strict ISO 8601 format using an LLM. Handles complex phrases like "next Tuesday at 10", "tomorrow afternoon", etc. Enforces business rules.',
  inputSchema: z.object({
    dateDescription: z.string().describe('The natural language text describing the date and time (e.g., "martes 20 a las 10hs").')
  }),
  execute: async ({ dateDescription }) => {
    console.log(`\u{1F916} LLM Parser Invoked with: "${dateDescription}"`);
    const now = /* @__PURE__ */ new Date();
    const currentIso = now.toISOString();
    const currentDayName = now.toLocaleDateString("es-AR", { weekday: "long" });
    const prompt = `
      Eres un experto asistente de calendario para una inmobiliaria en Argentina. 
      Tu \xFAnica funci\xF3n es convertir expresiones de fecha/hora en lenguaje natural a formato ISO 8601 estricto.

      CONTEXTO ACTUAL:
      - Fecha y Hora actual (Reference): ${currentIso}
      - D\xEDa de la semana actual: ${currentDayName}
      - Zona Horaria: America/Argentina/Buenos_Aires (-03:00)

      REGLAS DE NEGOCIO (ESTRICTAS):
      1. Si el usuario da solo fecha de inicio (ej: "martes 20 a las 10"), asume AUTOM\xC1TICAMENTE una duraci\xF3n de 1 HORA.
      2. Si la fecha mencionada ya pas\xF3 (ej: hoy es 20 y pide 'lunes 10'), asume que se refiere al futuro (mes siguiente o a\xF1o siguiente), NUNCA al pasado.
      3. Interpreta prefijos coloquiales ("dale", "bueno", "agendame", "quiero el") como ruido. Ign\xF3ralos.
      4. "Ma\xF1ana" se calcula desde la Fecha actual.
      5. Si no se especifica hora, asume 10:00 AM (horario laboral default).
      6. "Mediod\xEDa" = 12:00. "Tarde" = 15:00 (si no se especifica hora). "Noche" = 20:00.

      TU TAREA:
      Analiza el texto "${dateDescription}" y genera un JSON con start y end en formato ISO 8601 con offset correcto (-03:00).
    `;
    try {
      const { object } = await generateObject({
        model: openai$1("gpt-4o-mini"),
        schema: z.object({
          start: z.string().describe("ISO 8601 start date-time with -03:00 offset"),
          end: z.string().describe("ISO 8601 end date-time with -03:00 offset"),
          explanation: z.string().describe("Brief reason for the calculation")
        }),
        prompt,
        temperature: 0
        // Deterministic
      });
      console.log(`\u2705 LLM Parsed Result:`, JSON.stringify(object, null, 2));
      return {
        success: true,
        ...object
      };
    } catch (error) {
      console.error("\u274C LLM Parsing Failed:", error);
      return {
        success: false,
        error: error.message,
        start: null,
        end: null
      };
    }
  }
});

"use strict";
const CALENDAR_ID = "c.vogzan@gmail.com";
const getGoogleCalendar = () => {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!refreshToken || refreshToken === "tu_refresh_token") {
    throw new Error("GOOGLE_REFRESH_TOKEN is missing or invalid in environment variables");
  }
  auth.setCredentials({ refresh_token: refreshToken });
  return google.calendar({ version: "v3", auth });
};
const getSanitizedDates = (startIso, endIso) => {
  const timeZone = "America/Argentina/Buenos_Aires";
  const now = /* @__PURE__ */ new Date();
  let startDate = new Date(startIso);
  let endDate = new Date(endIso);
  if (startDate < now) {
    console.log("Detectada fecha pasada, corrigiendo a\xF1o...");
    startDate.setFullYear(startDate.getFullYear() + 1);
    endDate.setFullYear(endDate.getFullYear() + 1);
  }
  const toLocalIsoString = (date) => {
    const options = {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    };
    const localString = new Intl.DateTimeFormat("sv-SE", options).format(date);
    return localString.replace(" ", "T");
  };
  return {
    start: toLocalIsoString(startDate),
    end: toLocalIsoString(endDate)
  };
};
const parseDateInput = async (input) => {
  const isoDate = new Date(input);
  if (!isNaN(isoDate.getTime()) && input.includes("T")) {
    return input;
  }
  console.log(`\u26A0\uFE0F Input date '${input}' is not strict ISO. Attempting Natural Language Parse via Helper...`);
  const result = naturalDateToISO8601(input);
  if (!result.success || !result.isoDate) {
    throw new Error(`No pude entender la fecha indicada: "${input}". Error: ${result.error || "Desconocido"}. Por favor usa un formato m\xE1s claro.`);
  }
  console.log(`\u2705 Smart Parse Success: '${input}' -> ${result.isoDate}`);
  return result.isoDate;
};
const createCalendarEvent = createTool({
  id: "create_calendar_event",
  description: "Registra citas de visitas inmobiliarias en el calendario oficial de Fausti. \xDAsala cuando el cliente confirma un horario. Si hubo dudas que no pudiste responder, incl\xFAyelas en pendingQuestions.",
  inputSchema: z.object({
    title: z.string().optional().describe("T\xEDtulo descriptivo del evento"),
    start: z.string().describe("Fecha y hora de inicio (ISO u lenguaje natural)"),
    end: z.string().optional().describe("Fecha y hora de fin"),
    clientName: z.string().optional().describe("Nombre y Apellido del cliente"),
    clientPhone: z.string().optional().describe("Tel\xE9fono del cliente"),
    propertyAddress: z.string().optional().describe("Direcci\xF3n de la propiedad"),
    propertyLink: z.string().optional().describe("Link de la propiedad"),
    pendingQuestions: z.array(z.string()).optional().describe("Lista de preguntas que el cliente hizo y no pudiste responder seg\xFAn la base de datos")
  }),
  execute: async (input) => {
    console.log("\u{1F6E0}\uFE0F [TOOL START] create_calendar_event con preguntas pendientes");
    const calendar = getGoogleCalendar();
    const calendarId = CALENDAR_ID;
    try {
      let smartStart;
      let smartEnd;
      const isIsoStart = !isNaN(Date.parse(input.start)) && input.start.includes("T");
      if (isIsoStart) {
        smartStart = input.start;
        if (input.end && !isNaN(Date.parse(input.end)) && input.end.includes("T")) {
          smartEnd = input.end;
        } else {
          const startDate = new Date(smartStart);
          startDate.setHours(startDate.getHours() + 1);
          smartEnd = startDate.toISOString();
        }
      } else {
        const dateDescription = input.end ? `Inicio: ${input.start}. Fin: ${input.end}` : input.start;
        const parseResult = await llmDateParser.execute({ dateDescription });
        smartStart = parseResult.start;
        smartEnd = parseResult.end;
      }
      const { start, end } = getSanitizedDates(smartStart, smartEnd);
      const eventSummary = input.title || `Visita: ${input.clientName} - ${input.propertyAddress}`;
      let hasPendingQuestions = false;
      let description = `\u{1F3E0} VISITA INMOBILIARIA

`;
      description += `\u{1F464} Cliente: ${input.clientName}
`;
      description += `\u{1F4DE} Tel: ${input.clientPhone || "No provisto"}
`;
      description += `\u{1F4CD} Propiedad: ${input.propertyAddress}
`;
      description += `\u{1F517} Link: ${input.propertyLink || "Sin link"}

`;
      if (input.pendingQuestions && input.pendingQuestions.length > 0) {
        hasPendingQuestions = true;
        description += `\u26A0\uFE0F PREGUNTAS PENDIENTES POR RESPONDER EN LA VISITA:
`;
        input.pendingQuestions.forEach((q, i) => {
          description += `${i + 1}. ${q}
`;
        });
      }
      const response = await calendar.events.insert({
        calendarId,
        requestBody: {
          summary: eventSummary,
          location: input.propertyAddress,
          description,
          start: {
            dateTime: start,
            timeZone: "America/Argentina/Buenos_Aires"
          },
          end: {
            dateTime: end,
            timeZone: "America/Argentina/Buenos_Aires"
          }
        }
      });
      return {
        success: true,
        eventId: response.data.id,
        link: response.data.htmlLink,
        message: hasPendingQuestions ? "Cita agendada con las dudas del cliente registradas." : "Cita agendada exitosamente."
      };
    } catch (error) {
      console.error("\u274C Error en create_calendar_event:", error);
      return {
        success: false,
        data: null,
        instruction: "DATA_NOT_FOUND: No menciones este error. Procede con la informaci\xF3n que ya tengas o pregunta al usuario."
      };
    }
  }
});
const listCalendarEvents = createTool({
  id: "list_calendar_events",
  description: "Lista los pr\xF3ximos eventos del calendario para verificar disponibilidad.",
  inputSchema: z.object({
    daysAhead: z.number().default(15).describe("N\xFAmero de d\xEDas a futuro para consultar")
  }),
  execute: async (input) => {
    console.log("\u{1F6E0}\uFE0F Tool Invoked: list_calendar_events");
    console.log("\u{1F4E5} Input recibido:", JSON.stringify(input, null, 2));
    const { daysAhead } = input;
    const calendar = getGoogleCalendar();
    const calendarId = CALENDAR_ID;
    const timeMin = (/* @__PURE__ */ new Date()).toISOString();
    const timeMax = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1e3).toISOString();
    try {
      const response = await calendar.events.list({
        calendarId,
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: "startTime"
      });
      return response.data.items || [];
    } catch (error) {
      console.error("Error listando eventos de Google Calendar:", error);
      return { success: false, error: error.message };
    }
  }
});
const getCalendarEvent = createTool({
  id: "get_calendar_event",
  description: "Obtiene los detalles de un evento espec\xEDfico de Google Calendar usando su ID.",
  inputSchema: z.object({
    eventId: z.string().describe("ID del evento a obtener")
  }),
  execute: async (input) => {
    console.log("\u{1F6E0}\uFE0F Tool Invoked: get_calendar_event");
    console.log("\u{1F4E5} Input recibido:", JSON.stringify(input, null, 2));
    const { eventId } = input;
    const calendar = getGoogleCalendar();
    const calendarId = CALENDAR_ID;
    try {
      const response = await calendar.events.get({
        calendarId,
        eventId
      });
      return response.data;
    } catch (error) {
      console.error("Error obteniendo evento:", error);
      return { success: false, error: error.message };
    }
  }
});
const updateCalendarEvent = createTool({
  id: "update_calendar_event",
  description: "Actualiza un evento existente en Google Calendar. Puede cambiar horario, t\xEDtulo, descripci\xF3n o ubicaci\xF3n. ADMITE DATOS ESTRUCTURADOS.",
  inputSchema: z.object({
    eventId: z.string().describe("ID del evento a modificar"),
    summary: z.string().optional().describe("Nuevo t\xEDtulo del evento"),
    description: z.string().optional().describe("Nueva descripci\xF3n manual (NO RECOMENDADO - usar datos estructurados)"),
    location: z.string().optional().describe("Nueva ubicaci\xF3n"),
    start: z.string().optional().describe("Nueva fecha de inicio (ISO o Natural)"),
    end: z.string().optional().describe("Nueva fecha de fin (ISO o Natural)"),
    userEmail: z.string().optional().describe("Email del usuario para enviar notificaciones de actualizaci\xF3n (opcional)"),
    clientEmail: z.string().optional().describe("Email del cliente"),
    // Datos Estructurados para reconstrucción de formato
    clientName: z.string().optional().describe("Nombre y Apellido del cliente (para actualizar ficha)"),
    clientPhone: z.string().optional().describe("Tel\xE9fono del cliente"),
    propertyAddress: z.string().optional().describe("Direcci\xF3n de la propiedad"),
    propertyLink: z.string().optional().describe("Link de la propiedad")
  }),
  execute: async (input) => {
    console.log("\u{1F6E0}\uFE0F Tool Invoked: update_calendar_event");
    console.log("\u{1F4E5} Input recibido:", JSON.stringify(input, null, 2));
    const { eventId, summary, description, location, start, end, userEmail, clientName, clientPhone, clientEmail, propertyAddress, propertyLink } = input;
    const calendar = getGoogleCalendar();
    const calendarId = CALENDAR_ID;
    let currentEvent;
    try {
      const getRes = await calendar.events.get({ calendarId, eventId });
      currentEvent = getRes.data;
    } catch (e) {
      return { success: false, error: "Evento no encontrado: " + e.message };
    }
    try {
      let startBody = currentEvent.start;
      let endBody = currentEvent.end;
      if (start && end) {
        const smartStart = await parseDateInput(start);
        const smartEnd = await parseDateInput(end);
        const { start: sanitizedStart, end: sanitizedEnd } = getSanitizedDates(smartStart, smartEnd);
        startBody = { dateTime: sanitizedStart.replace(/Z$/, ""), timeZone: "America/Argentina/Buenos_Aires" };
        endBody = { dateTime: sanitizedEnd.replace(/Z$/, ""), timeZone: "America/Argentina/Buenos_Aires" };
      }
      let finalDescription = description || currentEvent.description;
      if (!description && (clientName || clientPhone || clientEmail || propertyAddress || propertyLink)) {
        const cName = clientName || "Cliente Actualizado";
        const cPhone = clientPhone || "Sin tel";
        const cEmail = clientEmail || "Sin email";
        const pAddress = propertyAddress || location || currentEvent.location || "Ver link";
        const pLink = propertyLink || "Sin link";
        finalDescription = `visita propiedad - cliente: ${cName} - tel: ${cPhone} - email: ${cEmail} - Domicilio: ${pAddress} - Link: ${pLink}`;
      }
      const requestBody = {
        ...currentEvent,
        summary: summary || currentEvent.summary,
        description: finalDescription,
        location: location || propertyAddress || currentEvent.location,
        // propertyAddress también actualiza location si se provee
        start: startBody,
        end: endBody
      };
      const response = await calendar.events.update({
        calendarId,
        eventId,
        requestBody,
        sendUpdates: userEmail ? "all" : "none"
        // Enviar correo si se provee email
      });
      return {
        success: true,
        eventId: response.data.id,
        link: response.data.htmlLink,
        updatedFields: { summary, location, start, end },
        message: "Evento actualizado correctamente."
      };
    } catch (error) {
      console.error("Error actualizando evento:", error);
      return { success: false, error: error.message };
    }
  }
});
const deleteCalendarEvent = createTool({
  id: "delete_calendar_event",
  description: "Elimina (cancela) un evento de Google Calendar permanentemente.",
  inputSchema: z.object({
    eventId: z.string().describe("ID del evento a eliminar"),
    notifyStart: z.boolean().optional().describe("No utilizado, pero mantenido por compatibilidad")
  }),
  execute: async (input) => {
    console.log("\u{1F6E0}\uFE0F Tool Invoked: delete_calendar_event");
    console.log("\u{1F4E5} Input recibido:", JSON.stringify(input, null, 2));
    const { eventId } = input;
    const calendar = getGoogleCalendar();
    const calendarId = CALENDAR_ID;
    try {
      await calendar.events.delete({
        calendarId,
        eventId
      });
      return { success: true, message: "Evento eliminado correctamente." };
    } catch (error) {
      console.error("Error eliminando evento:", error);
      return { success: false, error: error.message };
    }
  }
});
const getAvailableSlots = createTool({
  id: "get_available_slots",
  description: "Obtiene una selecci\xF3n estrat\xE9gica de horarios disponibles (uno por la ma\xF1ana y uno por la tarde) para los pr\xF3ximos 4 d\xEDas h\xE1biles, entre las 10:00 y las 16:00 hs.",
  inputSchema: z.object({}),
  execute: async () => {
    console.log("\u{1F6E0}\uFE0F [TOOL START] get_available_slots iniciado - Estrategia: Balanceada (AM/PM)");
    try {
      const calendar = getGoogleCalendar();
      const now = /* @__PURE__ */ new Date();
      const daysToCheck = 4;
      const workStartHour = 10;
      const workEndHour = 16;
      const splitHour = 13;
      const timezoneOffsetHours = 3;
      const slotDurationMinutes = 40;
      const bufferMinutes = 30;
      const proposedSlots = [];
      let daysFound = 0;
      let dayOffset = 1;
      while (daysFound < daysToCheck) {
        const currentDate = new Date(now);
        currentDate.setDate(now.getDate() + dayOffset);
        dayOffset++;
        const dayOfWeek = currentDate.getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) continue;
        daysFound++;
        const dayStart = new Date(currentDate);
        dayStart.setUTCHours(workStartHour + timezoneOffsetHours, 0, 0, 0);
        const dayEnd = new Date(currentDate);
        dayEnd.setUTCHours(workEndHour + timezoneOffsetHours, 0, 0, 0);
        const midDay = new Date(currentDate);
        midDay.setUTCHours(splitHour + timezoneOffsetHours, 0, 0, 0);
        try {
          const response = await calendar.events.list({
            calendarId: CALENDAR_ID,
            timeMin: dayStart.toISOString(),
            timeMax: dayEnd.toISOString(),
            singleEvents: true,
            orderBy: "startTime"
          });
          const events = response.data.items || [];
          let morningSlotFound = false;
          let afternoonSlotFound = false;
          let timeCursor = new Date(dayStart);
          while (timeCursor < dayEnd) {
            if (morningSlotFound && afternoonSlotFound) break;
            const proposedEnd = new Date(timeCursor.getTime() + slotDurationMinutes * 6e4);
            if (proposedEnd > dayEnd) break;
            const isMorning = timeCursor < midDay;
            if (isMorning && morningSlotFound) {
              timeCursor = new Date(timeCursor.getTime() + 30 * 6e4);
              continue;
            }
            if (!isMorning && afternoonSlotFound) {
              timeCursor = new Date(timeCursor.getTime() + 30 * 6e4);
              continue;
            }
            const hasConflict = events.some((event) => {
              if (!event.start.dateTime || !event.end.dateTime) return false;
              const eventStart = new Date(event.start.dateTime);
              const eventEnd = new Date(event.end.dateTime);
              const busyStartWithBuffer = new Date(eventStart.getTime() - bufferMinutes * 6e4);
              const busyEndWithBuffer = new Date(eventEnd.getTime() + bufferMinutes * 6e4);
              return timeCursor >= busyStartWithBuffer && timeCursor < busyEndWithBuffer || proposedEnd > busyStartWithBuffer && proposedEnd <= busyEndWithBuffer || timeCursor <= busyStartWithBuffer && proposedEnd >= busyEndWithBuffer;
            });
            if (!hasConflict) {
              proposedSlots.push({
                fecha: timeCursor.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", timeZone: "America/Argentina/Buenos_Aires" }),
                hora: timeCursor.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" }),
                iso: timeCursor.toISOString(),
                momento: isMorning ? "Ma\xF1ana" : "Tarde"
                // Metadato útil para el LLM
              });
              if (isMorning) {
                morningSlotFound = true;
                if (timeCursor < midDay) {
                  timeCursor = new Date(midDay);
                  continue;
                }
              } else {
                afternoonSlotFound = true;
              }
              timeCursor = new Date(timeCursor.getTime() + 60 * 6e4);
            } else {
              timeCursor = new Date(timeCursor.getTime() + 15 * 6e4);
            }
          }
        } catch (error) {
          console.error(`\u26A0\uFE0F Error fetching events for ${currentDate.toISOString()}:`, error);
        }
      }
      console.log(`\u2705 [TOOL END] Slots seleccionados: ${proposedSlots.length}`);
      return proposedSlots;
    } catch (criticalError) {
      console.error("\u274C [CRITICAL ERROR]", criticalError);
      return {
        success: false,
        error: criticalError.message,
        details: "Error interno verificando agenda."
      };
    }
  }
});
const findEventByNaturalDate = createTool({
  id: "find_event_by_natural_date",
  description: 'Busca eventos en el calendario usando una fecha/hora en lenguaje natural (ej. "lunes 12 a las 12", "ma\xF1ana al mediod\xEDa"). Retorna los eventos encontrados en esa fecha/hora exacta o aproximada.',
  inputSchema: z.object({
    query: z.string().describe('La fecha y hora en lenguaje natural. Ej: "Lunes 12 de enero a las 12", "12/01 a las 12:00"')
  }),
  execute: async ({ query }) => {
    console.log("\u{1F6E0}\uFE0F Tool Invoked: find_event_by_natural_date");
    console.log("\u{1F4E5} Query recibido:", query);
    const calendar = getGoogleCalendar();
    const result = naturalDateToISO8601(query, { futureDate: false });
    if (!result.success) {
      return { success: false, message: "No pude entender la fecha y hora indicadas. Por favor, intenta ser m\xE1s espec\xEDfico." };
    }
    const date = result.date;
    const hasTime = true;
    let timeMin;
    let timeMax;
    if (hasTime) {
      const searchCenter = date.getTime();
      const minDate = new Date(searchCenter - 15 * 6e4);
      const maxDate = new Date(searchCenter + 60 * 6e4);
      timeMin = minDate.toISOString();
      timeMax = maxDate.toISOString();
    } else {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);
      timeMin = startOfDay.toISOString();
      timeMax = endOfDay.toISOString();
    }
    try {
      const response = await calendar.events.list({
        calendarId: CALENDAR_ID,
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: "startTime"
      });
      const events = response.data.items || [];
      if (events.length === 0) {
        const dateStr = date.toLocaleDateString("es-AR", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
        const timeStr = hasTime ? ` a las ${date.getHours()}:${date.getMinutes().toString().padStart(2, "0")}` : "";
        return {
          success: true,
          events: [],
          message: `No encontr\xE9 eventos para el ${dateStr}${timeStr}.`,
          parsedDate: date.toISOString(),
          isTimeSpecific: hasTime
        };
      }
      const mappedEvents = events.map((e) => ({
        id: e.id,
        summary: e.summary,
        start: e.start.dateTime || e.start.date,
        end: e.end.dateTime || e.end.date,
        location: e.location,
        description: e.description,
        link: e.htmlLink
      }));
      return {
        success: true,
        events: mappedEvents,
        parsedDate: date.toISOString(),
        isTimeSpecific: hasTime
      };
    } catch (error) {
      console.error("Error buscando eventos por fecha natural:", error);
      return { success: false, error: error.message };
    }
  }
});
const CONFIG = {
  TIMEZONE_OFFSET: 3,
  // UTC-3
  WORK_START: 10,
  WORK_END: 16,
  SLOT_DURATION: 40,
  BUFFER: 30,
  LOCALE: "es-AR",
  TIMEZONE_STRING: "America/Argentina/Buenos_Aires"
};
const DAY_MAP = { "DOMINGO": 0, "LUNES": 1, "MARTES": 2, "MIERCOLES": 3, "JUEVES": 4, "VIERNES": 5, "SABADO": 6 };
const getAvailableSchedule = createTool({
  id: "get_available_schedule",
  description: '\xDAsala SIEMPRE que el usuario pregunte si hay disponibilidad en un d\xEDa, fecha u horario espec\xEDfico para una visita (ejemplo: "\xBFtenes disponibilidad el jueves 26?", "\xBFpodemos ir el viernes a la tarde?"). Nunca digas que no tienes esta informaci\xF3n; usa siempre esta herramienta para verificarlo.',
  inputSchema: z.object({
    intent: z.enum(["SPECIFIC_DAY", "PART_OF_DAY", "RANGE", "URGENT", "CONSTRAINT", "GENERAL"]).describe("La intenci\xF3n principal detectada en la solicitud del usuario (Casos A-F)"),
    targetDay: z.enum(["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES", "SABADO", "DOMINGO"]).optional().describe("Para caso SPECIFIC_DAY: El d\xEDa de la semana solicitado."),
    dayPart: z.enum(["MORNING", "AFTERNOON", "ANY"]).optional().describe("Preferencia de momento del d\xEDa. Morning < 13hs, Afternoon >= 13hs."),
    dateRangeDays: z.number().optional().describe("Para caso RANGE: Cu\xE1ntos d\xEDas buscar hacia adelante."),
    excludedDays: z.array(z.string()).optional().describe('D\xEDas a excluir (Ej: ["VIERNES"] para "menos los viernes").'),
    minHour: z.number().optional().describe('Restricci\xF3n de hora m\xEDnima (Ej: 16 para "a partir de las 16:00").')
  }),
  execute: async ({ intent, targetDay, dayPart, dateRangeDays, excludedDays, minHour }) => {
    console.log(`\u{1F9E0} [STRATEGY START] Intent: ${intent} | Day: ${targetDay || "N/A"} | Part: ${dayPart || "ANY"}`);
    try {
      const calendar = getGoogleCalendar();
      const now = /* @__PURE__ */ new Date();
      let searchConfig = {
        daysLookahead: 5,
        // Días a escanear
        maxSlotsPerDay: 2,
        // Cuantos slots guardar por día
        totalSlotsNeeded: 4,
        // Cuantos slots totales queremos retornar
        greedy: false,
        // Si es true, toma el primero que encuentra (Urgente)
        forceDay: -1
        // -1 cualquiera, 0-6 específico
      };
      switch (intent) {
        case "SPECIFIC_DAY":
          searchConfig.daysLookahead = 7;
          searchConfig.maxSlotsPerDay = 4;
          searchConfig.totalSlotsNeeded = 4;
          if (targetDay) searchConfig.forceDay = DAY_MAP[targetDay];
          break;
        case "PART_OF_DAY":
          searchConfig.daysLookahead = 4;
          searchConfig.maxSlotsPerDay = 2;
          searchConfig.totalSlotsNeeded = 2;
          break;
        case "RANGE":
          searchConfig.daysLookahead = dateRangeDays || 3;
          searchConfig.maxSlotsPerDay = 3;
          searchConfig.totalSlotsNeeded = 9;
          break;
        case "URGENT":
          searchConfig.daysLookahead = 2;
          searchConfig.greedy = true;
          searchConfig.totalSlotsNeeded = 3;
          break;
        case "CONSTRAINT":
          searchConfig.daysLookahead = 7;
          searchConfig.maxSlotsPerDay = 2;
          searchConfig.totalSlotsNeeded = 3;
          break;
        case "GENERAL":
        // Caso F
        default:
          searchConfig.daysLookahead = 3;
          searchConfig.maxSlotsPerDay = 4;
          searchConfig.totalSlotsNeeded = 4;
          break;
      }
      const foundSlots = [];
      let daysChecked = 0;
      let currentOffset = 0;
      while (daysChecked < searchConfig.daysLookahead && foundSlots.length < searchConfig.totalSlotsNeeded) {
        const checkDate = new Date(now);
        checkDate.setDate(now.getDate() + currentOffset);
        currentOffset++;
        const weekDay = checkDate.getDay();
        const isWeekend = weekDay === 0 || weekDay === 6;
        if (searchConfig.forceDay !== -1 && weekDay !== searchConfig.forceDay) continue;
        if (isWeekend && intent !== "CONSTRAINT" && intent !== "SPECIFIC_DAY") continue;
        if (excludedDays && excludedDays.some((d) => DAY_MAP[d] === weekDay)) continue;
        daysChecked++;
        const startH = minHour && minHour > CONFIG.WORK_START ? minHour : CONFIG.WORK_START;
        const dayStart = new Date(checkDate);
        dayStart.setUTCHours(startH + CONFIG.TIMEZONE_OFFSET, 0, 0, 0);
        const dayEnd = new Date(checkDate);
        dayEnd.setUTCHours(CONFIG.WORK_END + CONFIG.TIMEZONE_OFFSET, 0, 0, 0);
        if (dayStart < now) {
          if (now > dayEnd) continue;
          if (now > dayStart) dayStart.setTime(now.getTime() + 30 * 6e4);
        }
        const events = await fetchEventsForDay(calendar, dayStart, dayEnd);
        let slotsInThisDay = 0;
        let timeCursor = new Date(dayStart);
        while (timeCursor < dayEnd && slotsInThisDay < searchConfig.maxSlotsPerDay) {
          if (foundSlots.length >= searchConfig.totalSlotsNeeded) break;
          const proposedEnd = new Date(timeCursor.getTime() + CONFIG.SLOT_DURATION * 6e4);
          if (proposedEnd > dayEnd) break;
          const hourAR = timeCursor.getUTCHours() - CONFIG.TIMEZONE_OFFSET;
          const isMorning = hourAR < 13;
          const isAfternoon = hourAR >= 13;
          if (dayPart === "MORNING" && !isMorning) {
            timeCursor = new Date(timeCursor.getTime() + 30 * 6e4);
            continue;
          }
          if (dayPart === "AFTERNOON" && !isAfternoon) {
            timeCursor = new Date(timeCursor.getTime() + 30 * 6e4);
            continue;
          }
          if (!checkConflict(timeCursor, proposedEnd, events)) {
            foundSlots.push({
              fecha: timeCursor.toLocaleDateString(CONFIG.LOCALE, { weekday: "long", day: "numeric", month: "numeric", timeZone: CONFIG.TIMEZONE_STRING }),
              hora: timeCursor.toLocaleTimeString(CONFIG.LOCALE, { hour: "2-digit", minute: "2-digit", timeZone: CONFIG.TIMEZONE_STRING }),
              franja: isMorning ? "Ma\xF1ana" : "Tarde",
              iso: timeCursor.toISOString()
            });
            slotsInThisDay++;
            if (searchConfig.greedy) {
            } else {
              timeCursor = new Date(timeCursor.getTime() + 60 * 6e4);
              continue;
            }
          }
          timeCursor = new Date(timeCursor.getTime() + 15 * 6e4);
        }
      }
      return {
        summary: `Se encontraron ${foundSlots.length} opciones bajo la estrategia '${intent}'.`,
        slots: foundSlots,
        strategy_used: intent
      };
    } catch (error) {
      console.error("\u274C Error en get_available_slots:", error);
      throw new Error("Fallo en el servicio de calendario.");
    }
  }
});
async function fetchEventsForDay(calendar, start, end) {
  const res = await calendar.events.list({
    calendarId: "primary",
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: true
  });
  return res.data.items || [];
}
function checkConflict(start, end, events) {
  return events.some((event) => {
    const eStart = new Date(event.start.dateTime);
    const eEnd = new Date(event.end.dateTime);
    const buffer = CONFIG.BUFFER * 6e4;
    return start < new Date(eEnd.getTime() + buffer) && end > new Date(eStart.getTime() - buffer);
  });
}

"use strict";
const apifyScraperTool = createTool({
  id: "apify-web-scraper",
  description: `Extrae el contenido textual crudo de una URL.`,
  inputSchema: z.object({
    url: z.string().url()
  }),
  outputSchema: z.object({
    success: z.boolean(),
    data: z.array(z.any()).optional(),
    error: z.string().optional()
  }),
  execute: async ({ url }) => {
    const APIFY_TOKEN = process.env.APIFY_TOKEN;
    const ACTOR_NAME = "apify~website-content-crawler";
    if (!APIFY_TOKEN) {
      return { success: false, error: "Falta APIFY_TOKEN en .env" };
    }
    try {
      const response = await axios.post(
        `https://api.apify.com/v2/acts/${ACTOR_NAME}/runs?token=${APIFY_TOKEN}`,
        { startUrls: [{ url }] }
      );
      const runId = response.data.data.id;
      const datasetId = response.data.data.defaultDatasetId;
      let status = "RUNNING";
      while (status === "RUNNING" || status === "READY") {
        await new Promise((r) => setTimeout(r, 2e3));
        const check = await axios.get(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`);
        status = check.data.data.status;
      }
      const items = await axios.get(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}`);
      return {
        success: true,
        data: items.data
      };
    } catch (e) {
      const msg = e.response?.data?.error?.message || e.message;
      return { success: false, error: msg };
    }
  }
});

"use strict";
const getGmail$2 = () => {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!refreshToken || refreshToken === "tu_refresh_token") {
    throw new Error("GOOGLE_REFRESH_TOKEN is missing or invalid in environment variables");
  }
  auth.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: "v1", auth });
};
const sendEmail = createTool({
  id: "send_gmail",
  description: "Env\xEDa un correo electr\xF3nico a un cliente.",
  inputSchema: z.object({
    to: z.string().email(),
    subject: z.string(),
    body: z.string()
  }),
  execute: async (context) => {
    const gmail = getGmail$2();
    const { to, subject, body } = context;
    const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString("base64")}?=`;
    const messageParts = [
      `From: Me <me@gmail.com>`,
      `To: ${to}`,
      `Content-Type: text/html; charset=utf-8`,
      `MIME-Version: 1.0`,
      `Subject: ${utf8Subject}`,
      "",
      body
    ];
    const message = messageParts.join("\n");
    const encodedMessage = Buffer.from(message).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const res = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw: encodedMessage }
    });
    return res.data;
  }
});
const listEmails = createTool({
  id: "list_emails",
  description: "Lee los \xFAltimos correos recibidos para clasificarlos.",
  inputSchema: z.object({
    maxResults: z.number().default(5)
  }),
  execute: async (context) => {
    const gmail = getGmail$2();
    const { maxResults } = context;
    const list = await gmail.users.messages.list({ userId: "me", maxResults });
    const messages = await Promise.all(
      (list.data.messages || []).map(async (msg) => {
        const detail = await gmail.users.messages.get({ userId: "me", id: msg.id });
        return {
          id: msg.id,
          snippet: detail.data.snippet,
          subject: detail.data.payload?.headers?.find((h) => h.name === "Subject")?.value
        };
      })
    );
    return messages;
  }
});

"use strict";
const getGmail$1 = () => {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.gmail({ version: "v1", auth });
};
const potentialSaleEmailTool = createTool({
  id: "potential_sale_email",
  description: "\xDAsala \xDANICAMENTE cuando el usuario confirme inter\xE9s en comprar una propiedad y YA TENGAS su nombre. Env\xEDa un correo interno al equipo de ventas con los datos del lead y la propiedad",
  inputSchema: z.object({
    nombre_cliente: z.string().optional().describe("Nombre completo del interesado"),
    telefono_cliente: z.string().optional().describe("N\xFAmero de tel\xE9fono de contacto"),
    email_cliente: z.string().optional().describe("Email si estuviera disponible"),
    direccion_propiedad: z.string().optional().describe("Direcci\xF3n o t\xEDtulo de la propiedad de inter\xE9s"),
    url_propiedad: z.string().optional().describe("Link de la publicaci\xF3n (Zonaprop, etc)")
  }),
  execute: async (input) => {
    console.log("\u{1F6E0}\uFE0F Tool Invoked: potential_sale_email");
    console.log("\u{1F4E5} Input recibido:", JSON.stringify(input, null, 2));
    const gmail = getGmail$1();
    console.log("\u{1F527} Gmail client initialized");
    const recipients = ["c.vogzan@gmail.com", "faustiprop@gmail.com", "diego.barrueta@gmail.com"];
    const telLimpio = input.telefono_cliente?.replace(/[^0-9]/g, "");
    const htmlBody = `
      <!DOCTYPE html> <html> <head> <style> 
      body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; } 
      .container { width: 100%; max-width: 600px; margin: 20px auto; border: 1px solid #eee; border-radius: 8px; overflow: hidden; } 
      .header { background-color: #2c3e50; color: #ffffff; padding: 20px; text-align: center; } 
      .content { padding: 20px; } 
      .field-label { font-weight: bold; color: #7f8c8d; text-transform: uppercase; font-size: 12px; } 
      .field-value { margin-bottom: 15px; font-size: 16px; border-bottom: 1px solid #f9f9f9; padding-bottom: 5px; } 
      .footer { background-color: #f4f4f4; padding: 15px; text-align: center; font-size: 12px; color: #95a5a6; } 
      .tag { background-color: #e67e22; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; } 
      </style> </head> 
      <body> 
        <div class="container"> 
          <div class="header"> <h2>\u26A0\uFE0F Nueva Potencial Venta</h2> <span class="tag">AVISO DE INTER\xC9S</span> </div> 
          <div class="content"> 
            <p>Hola, <strong>Nico</strong> ha detectado un cliente interesado en una propiedad de venta:</p> 
            <div class="field-label">Cliente</div> <div class="field-value">${input.nombre_cliente}</div> 
            <div class="field-label">Tel\xE9fono de contacto</div> 
            <div class="field-value"> <a href="https://wa.me/${telLimpio}" style="color: #27ae60; text-decoration: none; font-weight: bold;"> ${input.telefono_cliente} (WhatsApp) </a> </div> 
            <div class="field-label">Email</div> <div class="field-value">${input.email_cliente || "No proporcionado"}</div> 
            <div class="field-label">Propiedad</div> <div class="field-value">${input.direccion_propiedad || "No especificada / URL"}</div> 
            <div style="margin-top: 25px; text-align: center;"> 
              <a href="${input.url_propiedad}" style="background-color: #3498db; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;"> Ver Ficha de Propiedad </a> 
            </div> 
          </div> 
          <div class="footer"> Este es un aviso autom\xE1tico generado por el Agente IA de Fausti Propiedades. </div> 
        </div> 
      </body> </html>`;
    const subject = `\u26A0\uFE0F Nueva Potencial Venta - ${input.nombre_cliente}`;
    const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString("base64")}?=`;
    const sendPromises = recipients.map(async (to) => {
      console.log(`\u{1F4E7} Preparing email for: ${to}`);
      const messageParts = [
        `From: Nico Agent <me@gmail.com>`,
        `To: ${to}`,
        `Content-Type: text/html; charset=utf-8`,
        `MIME-Version: 1.0`,
        `Subject: ${utf8Subject}`,
        "",
        htmlBody
      ];
      const message = messageParts.join("\n");
      const encodedMessage = Buffer.from(message).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      try {
        console.log(`\u{1F680} Sending to: ${to}`);
        const res = await gmail.users.messages.send({
          userId: "me",
          requestBody: { raw: encodedMessage }
        });
        console.log(`\u2705 Email sent to: ${to} - Status: ${res.status}`);
        return res;
      } catch (innerErr) {
        console.error(`\u274C Error sending to ${to}:`, innerErr);
        throw innerErr;
      }
    });
    try {
      await Promise.all(sendPromises);
      console.log("\u{1F3C1} All emails processed");
    } catch (err) {
      console.error("Error global enviando mails de venta:", err);
      throw new Error("Fall\xF3 el env\xEDo del correo de venta. Revisa los logs.");
    }
    return {
      status: "success",
      message: "La notificaci\xF3n ha sido enviada a los responsables de la inmobiliaria."
    };
  }
});

"use strict";

"use strict";
const getGmail = () => {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.gmail({ version: "v1", auth });
};
const notificarEquipoTool = createTool({
  id: "notificar_equipo",
  description: "\xDAsala EXCLUSIVAMENTE cuando el usuario no cumpla los requisitos de alquiler y acepte que un asesor humano lo contacte para buscar alternativas.",
  inputSchema: z.object({
    motivo: z.string().describe("Raz\xF3n exacta por la que se deriva (ej: No tiene recibo de sueldo ni garant\xEDa)"),
    nombre_cliente: z.string().optional().describe("Nombre completo del interesado"),
    telefono_cliente: z.string().optional().describe("N\xFAmero de tel\xE9fono de contacto"),
    url_propiedad: z.string().optional().describe("Link de la publicaci\xF3n")
  }),
  execute: async (input) => {
    console.log("\u{1F6E0}\uFE0F Tool Invoked: notificar_equipo");
    console.log("\u{1F4E5} Input recibido:", JSON.stringify(input, null, 2));
    const gmail = getGmail();
    console.log("\u{1F527} Gmail client initialized");
    const recipients = ["c.vogzan@gmail.com", "faustiprop@gmail.com", "diego.barrueta@gmail.com"];
    const telLimpio = input.telefono_cliente?.replace(/[^0-9]/g, "");
    const htmlBody = `
      <!DOCTYPE html> <html> <head> <style> 
      body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; } 
      .container { width: 100%; max-width: 600px; margin: 20px auto; border: 1px solid #eee; border-radius: 8px; overflow: hidden; } 
      .header { background-color: #e74c3c; color: #ffffff; padding: 20px; text-align: center; } 
      .content { padding: 20px; } 
      .field-label { font-weight: bold; color: #7f8c8d; text-transform: uppercase; font-size: 12px; } 
      .field-value { margin-bottom: 15px; font-size: 16px; border-bottom: 1px solid #f9f9f9; padding-bottom: 5px; } 
      .footer { background-color: #f4f4f4; padding: 15px; text-align: center; font-size: 12px; color: #95a5a6; } 
      .tag { background-color: #f39c12; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; } 
      </style> </head> 
      <body> 
        <div class="container"> 
          <div class="header"> <h2>\u26A0\uFE0F Notificaci\xF3n de Asesoramiento</h2> <span class="tag">REQUISITOS NO CUMPLIDOS</span> </div> 
          <div class="content"> 
            <p>Hola, <strong>Nico</strong> ha notificado que un cliente no cumple con los requisitos de alquiler y ha solicitado ser contactado por un asesor humano para buscar alternativas:</p> 
            <div class="field-label">Cliente</div> <div class="field-value">${input.nombre_cliente || "No especificado"}</div> 
            <div class="field-label">Tel\xE9fono de contacto</div> 
            <div class="field-value">
              ${input.telefono_cliente ? `<a href="https://wa.me/${telLimpio}" style="color: #27ae60; text-decoration: none; font-weight: bold;"> ${input.telefono_cliente} (WhatsApp) </a>` : "No especificado"}
            </div> 
            <div class="field-label">URL de la Propiedad</div> 
            <div class="field-value">
              ${input.url_propiedad ? `<a href="${input.url_propiedad}" style="color: #3498db; text-decoration: none; word-break: break-all;">${input.url_propiedad}</a>` : "No especificada"}
            </div> 
          </div> 
          <div class="footer"> Este es un aviso autom\xE1tico generado por el Agente IA de Fausti Propiedades. </div> 
        </div> 
      </body> </html>`;
    const subject = `\u26A0\uFE0F Solicita Asesoramiento - ${input.nombre_cliente} - ${input.motivo}`;
    const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString("base64")}?=`;
    const sendPromises = recipients.map(async (to) => {
      console.log(`\u{1F4E7} Preparing email for: ${to}`);
      const messageParts = [
        `From: Nico Agent <me@gmail.com>`,
        `To: ${to}`,
        `Content-Type: text/html; charset=utf-8`,
        `MIME-Version: 1.0`,
        `Subject: ${utf8Subject}`,
        "",
        htmlBody
      ];
      const message = messageParts.join("\n");
      const encodedMessage = Buffer.from(message).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      try {
        console.log(`\u{1F680} Sending to: ${to}`);
        const res = await gmail.users.messages.send({
          userId: "me",
          requestBody: { raw: encodedMessage }
        });
        console.log(`\u2705 Email sent to: ${to} - Status: ${res.status}`);
        return res;
      } catch (innerErr) {
        console.error(`\u274C Error sending to ${to}:`, innerErr);
        throw innerErr;
      }
    });
    try {
      await Promise.all(sendPromises);
      console.log("\u{1F3C1} All emails processed");
    } catch (err) {
      console.error("Error global enviando mails de venta:", err);
      throw new Error("Fall\xF3 el env\xEDo del correo de venta. Revisa los logs.");
    }
    return {
      status: "success",
      message: "El equipo de ventas ha sido notificado y se pondr\xE1 en contacto pronto."
    };
  }
});

"use strict";
const DEFAULT_SYSTEM_PROMPT = `Eres un asistente inmobiliario de Mastra. Esperando instrucciones de contexto...`;
const getRealEstateAgent = async (userId, instructionsInjected, operacionTipo) => {
  const memory = new Memory({
    storage,
    vector: vectorStore,
    embedder: openai$1.embedding("text-embedding-3-small"),
    options: {
      lastMessages: 31,
      semanticRecall: {
        topK: 3,
        messageRange: 3
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
          `
      },
      generateTitle: true
    }
  });
  const finalInstructions = instructionsInjected || DEFAULT_SYSTEM_PROMPT;
  const op = (operacionTipo || "").trim().toUpperCase();
  const selectedTools = op === "ALQUILAR" ? { get_available_slots: getAvailableSlots, create_calendar_event: createCalendarEvent, find_event_by_natural_date: findEventByNaturalDate, update_calendar_event: updateCalendarEvent, delete_calendar_event: deleteCalendarEvent, get_available_schedule: getAvailableSchedule, notificar_equipo: notificarEquipoTool } : op === "VENDER" ? { potential_sale_email: potentialSaleEmailTool } : {};
  console.log("#".repeat(50) + " REAL ESTATE AGENT " + "#".repeat(50));
  console.log(finalInstructions);
  console.log("#".repeat(50));
  console.log("");
  console.log("=".repeat(50));
  console.log("\u{1F6E0}\uFE0F TOOLS ACTIVAS:", Object.keys(selectedTools));
  console.log("=".repeat(50));
  return new Agent({
    // ID obligatorio para Mastra
    id: "real-estate-agent",
    name: "Real Estate Agent",
    instructions: finalInstructions,
    model: openai$1("gpt-4o"),
    memory,
    tools: selectedTools,
    inputProcessors: [
      new PromptInjectionDetector({
        model: openai$1("gpt-4o-mini"),
        threshold: 0.8,
        strategy: "block"
      }),
      new ModerationProcessor({
        model: openai$1("gpt-4o-mini"),
        threshold: 0.7,
        strategy: "block"
      }),
      new TokenLimiter(3e3)
    ],
    outputProcessors: [
      new SystemPromptScrubber({
        model: openai$1("gpt-4o-mini"),
        strategy: "redact",
        redactionMethod: "placeholder"
      }),
      new WhatsAppStyleProcessor()
    ]
  });
};

"use strict";
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});
const realEstatePropertyFormatterTool = createTool({
  id: "real-estate-property-formatter",
  description: "Extrae requisitos y pol\xEDtica de mascotas de descripciones inmobiliarias usando Few-Shot estructural.",
  inputSchema: z.object({
    keywordsZonaProp: z.string().describe("Descripci\xF3n bruta de la propiedad")
  }),
  outputSchema: z.object({
    formattedText: z.string().describe("Requisitos y Mascotas extra\xEDdos")
  }),
  execute: async ({ keywordsZonaProp }) => {
    console.log("   [Tool] \u{1F6E0}\uFE0F  Ejecutando extracci\xF3n t\xE9cnica...");
    const systemPrompt = `
    # ROL
    Eres un Arquitecto de Datos Inmobiliarios. Tu misi\xF3n es transformar descripciones desordenadas en datos estructurados de requisitos y mascotas.

    # REGLAS DE ORO
    1. Si no hay menci\xF3n de mascotas, el campo Mascotas debe ser estrictamente: Sin descripci\xF3n disponible.
    2. Limpia todo el ruido legal de "medidas aproximadas" o "fotos no vinculantes".
    3. Mant\xE9n la literalidad en los requisitos de garant\xEDa e ingresos.

    # EJEMPLOS DE APRENDIZAJE
    <examples>
      <example>
        <input>
          "Departamento monoambiente... Alquiler: $390.000 + Expensas. Requisitos: Garant\xEDa propietaria con justificaci\xF3n de ingresos de garantes (recibo de sueldo, monotributo, ganancias, etc.). El locatario deber\xE1 gestionar un seguro de incendio sobre el inmueble. - Nota importante: Toda la informaci\xF3n y medidas provistas son aproximadas..."
        </input>
        <output>
          Requisitos: Garant\xEDa propietaria con justificaci\xF3n de ingresos de garantes (recibo de sueldo, monotributo, ganancias, etc.). El locatario deber\xE1 gestionar un seguro de incendio sobre el inmueble.
          Mascotas: Sin descripci\xF3n disponible
        </output>
      </example>

      <example>
        <input>
          "Casa en alquiler... $1.400.000. Requisitos: Garant\xEDa propietaria con justificaci\xF3n de ingresos de garantes (recibo de sueldo, monotributo, ganancias, etc.) y seguro de incendio. - Nota importante: Los gastos expresados refieren a la \xFAltima informaci\xF3n recabada..."
        </input>
        <output>
          Requisitos: Garant\xEDa propietaria con justificaci\xF3n de ingresos de garantes (recibo de sueldo, monotributo, ganancias, etc.) y seguro de incendio.
          Mascotas: Sin descripci\xF3n disponible
        </output>
      </example>

      <example>
        <input>
          "Departamento 3 ambientes... NO SE PERMITEN MASCOTAS. SE ENTREGA RECI\xC9N PINTADO!!! Alquiler: $790.000. Requisitos: Garant\xEDa propietaria con justificaci\xF3n de ingresos de inquilinos y garantes (recibo de sueldo, monotributo, ganancias, etc.) y seguro de incendio."
        </input>
        <output>
          Requisitos: Garant\xEDa propietaria con justificaci\xF3n de ingresos de inquilinos y garantes (recibo de sueldo, monotributo, ganancias, etc.) y seguro de incendio.
          Mascotas: NO SE PERMITEN MASCOTAS. SE ENTREGA RECI\xC9N PINTADO!!!
        </output>
      </example>
    </examples>

    # FORMATO DE RESPUESTA FINAL
    Requisitos: [Texto]
    Mascotas: [Texto o Sin descripci\xF3n disponible]
    `;
    try {
      const completion = await openai.chat.completions.create({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Extrae los datos de este texto:

${keywordsZonaProp}` }
        ],
        model: "gpt-4o-mini",
        temperature: 0
        // Determinismo puro para extracción de datos
      });
      return {
        formattedText: completion.choices[0]?.message?.content || "No se pudo procesar."
      };
    } catch (error) {
      console.error("   [Tool] \u274C Error:", error.message);
      throw new Error("Error en el procesamiento de datos inmobiliarios.");
    }
  }
});

"use strict";
const realEstateCleaningAgent = new Agent({
  id: "real-estate-cleaning-agent",
  name: "Real Estate Cleaning Agent",
  tools: { realEstatePropertyFormatterTool },
  instructions: `
    Eres un experto en procesamiento de datos inmobiliarios. 
    Tu especialidad es la extracci\xF3n de entidades desde texto no estructurado.
    Eres obsesivo con la coherencia y la eliminaci\xF3n de duplicados.
    No a\xF1ades comentarios adicionales, solo devuelves el listado solicitado.  
    El tono debe ser profesional y persuasivo, destacando los beneficios.

    siempre usa la herramienta realEstatePropertyFormatterTool para extraer la informaci\xF3n.
  `,
  model: "openai/gpt-4.1-mini"
});

"use strict";
const ADDRESS_EXTRACTION_PROMPT = `
Eres un experto en identificar y normalizar direcciones postales a partir de contenido inmobiliario.

TU TAREA PRINCIPAL:
Extraer la direcci\xF3n postal de una URL de propiedad, priorizando el an\xE1lisis de la estructura de la URL.

### ALGORITMO PARA URLs DE ZONAPROP:
Si la URL pertenece a Zonaprop, sigue estrictamente este procedimiento de limpieza de texto sobre la URL misma:

1. **Localizar el segmento clave**: Identifica la parte de la URL que est\xE1 despu\xE9s de \`/clasificado/\` y antes del primer guion que precede al n\xFAmero de ID (ejemplo: \`-56673355\`).
2. **Eliminar el prefijo de operaci\xF3n**: Ignora los primeros caracteres que terminan en 'in' (como \`vecllcin-\`, \`alclapin-\`, \`veclcain-\`). Estos representan el tipo de propiedad y operaci\xF3n, no la direcci\xF3n.
3. **Limpieza de Guiones**: Reemplaza todos los guiones medios (-) por espacios.
4. **Capitalizaci\xF3n**: Convierte el texto resultante a 'Title Case' (Primera letra de cada palabra en may\xFAscula).
5. **Validaci\xF3n**: El resultado debe contener el nombre de la calle y la altura num\xE9rica.

### EJEMPLOS (FEW-SHOT):

**Caso 1:**
URL: \`https://www.zonaprop.com.ar/propiedades/clasificado/vecllcin-av-meeks-158-56673355.html\`
Extracci\xF3n: "Av Meeks 158"

**Caso 2:**
URL: \`https://www.zonaprop.com.ar/propiedades/clasificado/alclapin-gorriti-368-56339731.html\`
Extracci\xF3n: "Gorriti 368"

### FORMATO DE SALIDA (JSON):
Debes responder \xDANICAMENTE con un objeto JSON v\xE1lido con la siguiente estructura exacta.
No incluyas markdown, ni bloques de c\xF3digo, solo el JSON raw.

Estructura requerida:
{
  "filters": [
    ["address", "contains", "DIRECCION_EXTRAIDA"] 
  ],
  "current_localization_type": "country",
  "current_localization_id": 1, 
  "price_from": 0,
  "price_to": 99999999,
  "operation_types": [1, 2, 3],
  "property_types": [1, 2, 3, 4, 5, 6, 7, 8]
}

Donde "DIRECCION_EXTRAIDA" es la direcci\xF3n que obtuviste del an\xE1lisis. 
Si no puedes extraer ninguna direcci\xF3n, devuelve null en ese campo o maneja el error, pero intenta siempre inferir algo de la URL.
`;
const addressExtractionAgent = new Agent({
  id: "address-extraction-agent",
  name: "Address Extraction Agent",
  instructions: ADDRESS_EXTRACTION_PROMPT,
  model: openai$1("gpt-4o-mini")
});

"use strict";
const sleep$1 = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const tokkoPropertySearchTool = createTool({
  id: "tokko-property-search",
  description: `Busca propiedades en Tokko Broker utilizando un filtro avanzado.`,
  inputSchema: z.object({
    filters: z.array(z.tuple([z.string(), z.string(), z.string()])),
    current_localization_type: z.string(),
    current_localization_id: z.number(),
    price_from: z.number(),
    price_to: z.number(),
    operation_types: z.array(z.number()),
    property_types: z.array(z.number())
  }),
  outputSchema: z.object({
    success: z.boolean(),
    data: z.custom().optional(),
    // Using the imported type
    error: z.string().optional()
  }),
  execute: async (params) => {
    const TOKKO_API_KEY = "4b83dbe841cb6d1c70bfbefd87488f07317f623a";
    const BASE_URL = "https://www.tokkobroker.com/api/v1/property/search";
    let baseAddress = "";
    const addressFilterIndex = params.filters.findIndex((f) => f[0] === "address");
    if (addressFilterIndex !== -1) {
      baseAddress = params.filters[addressFilterIndex][2];
    }
    let addressVariations = [];
    if (baseAddress) {
      const cleaned = baseAddress.trim();
      addressVariations.push(cleaned);
      const match = cleaned.match(/^(.+?)\s+(\d+)$/);
      if (match) {
        const streetName = match[1].trim();
        const number = match[2].trim();
        addressVariations.push(`${streetName} N ${number}`);
        addressVariations.push(`${streetName} n ${number}`);
        addressVariations.push(`${streetName} N\xBA ${number}`);
      }
      const lower = cleaned.toLowerCase();
      if (!addressVariations.includes(lower)) {
        addressVariations.push(lower);
      }
      if (match) {
        const streetNameLower = match[1].trim().toLowerCase();
        if (!addressVariations.includes(streetNameLower)) {
          addressVariations.push(streetNameLower);
        }
      }
      const upper = cleaned.toUpperCase();
      if (!addressVariations.includes(upper)) {
        addressVariations.push(upper);
      }
    } else {
      addressVariations.push("");
    }
    let lastResult = null;
    for (const addressVariant of addressVariations) {
      const currentParams = JSON.parse(JSON.stringify(params));
      if (addressVariant && currentParams.filters) {
        const idx = currentParams.filters.findIndex((f) => f[0] === "address");
        if (idx !== -1) {
          currentParams.filters[idx][2] = addressVariant;
        }
      }
      console.log(`\u{1F50E} Tokko Search attempting address: "${addressVariant}" ...`);
      try {
        const dataParam = JSON.stringify(currentParams);
        const response = await axios.get(BASE_URL, {
          params: {
            limit: 20,
            // Increased limit as per user example result
            data: dataParam,
            key: TOKKO_API_KEY,
            lang: "es_ar",
            format: "json"
          }
        });
        lastResult = {
          success: true,
          data: response.data
        };
        const objectsFound = response.data.objects?.length || 0;
        if (objectsFound > 0) {
          console.log(`\u2705 MATCH FOUND for address: "${addressVariant}" (${objectsFound} objects)`);
          return lastResult;
        } else {
          console.log(`\u274C No match for: "${addressVariant}". Retrying in 3s...`);
        }
      } catch (e) {
        const msg = e.response?.data?.error_message || e.message;
        console.error(`\u274C Error searching for "${addressVariant}":`, msg);
        lastResult = { success: false, error: msg };
      }
      if (addressVariations.indexOf(addressVariant) < addressVariations.length - 1) {
        await sleep$1(3e3);
      }
    }
    return lastResult || { success: false, error: "Unknown error" };
  }
});

"use strict";
const extractAddressFromUrlTool = createTool({
  id: "extract-address-from-url",
  description: `Extrae la direcci\xF3n postal y estructura el filtro de b\xFAsqueda a partir de una URL de Zonaprop utilizando l\xF3gica determin\xEDstica (regex).`,
  inputSchema: z.object({
    url: z.string().url()
  }),
  outputSchema: z.object({
    filters: z.array(z.tuple([z.string(), z.string(), z.string()])),
    current_localization_type: z.string(),
    current_localization_id: z.number(),
    price_from: z.number(),
    price_to: z.number(),
    operation_types: z.array(z.number()),
    property_types: z.array(z.number())
  }),
  execute: async ({ url }) => {
    const result = {
      filters: [],
      current_localization_type: "country",
      current_localization_id: 1,
      price_from: 0,
      price_to: 99999999,
      operation_types: [1, 2, 3],
      property_types: [1, 2, 3, 4, 5, 6, 7, 8]
    };
    try {
      if (url.includes("zonaprop.com.ar")) {
        const match = url.match(/\/clasificado\/(.+?)-(\d+)\.html/);
        if (match) {
          let slug = match[1];
          const prefixMatch = slug.match(/^([a-z]+in-)/);
          if (prefixMatch) {
            slug = slug.replace(prefixMatch[1], "");
          }
          let address = slug.replace(/-/g, " ");
          address = address.split(" ").map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ");
          if (/\d+/.test(address)) {
            result.filters.push(["address", "contains", address]);
          }
        }
      }
      return result;
    } catch (e) {
      return result;
    }
  }
});

"use strict";
const defaultClientData = {
  nombre: "",
  apellido: "",
  email: "",
  telefono: "",
  link: "",
  tipoOperacion: "",
  propiedadInfo: "",
  propertyAddress: "",
  mascotas: "",
  requisitos: ""
};

"use strict";
let datos = defaultClientData;
const dynamicInstructions = (datos2, op) => {
  const ahora = new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    hour: "numeric",
    hour12: false
  }).format(/* @__PURE__ */ new Date());
  const hora = parseInt(ahora);
  let momentoDia = "";
  if (hora >= 5 && hora < 14) momentoDia = "\xA1Buen d\xEDa!";
  else if (hora >= 14 && hora < 20) momentoDia = "\xA1Buenas tardes!";
  else momentoDia = "\xA1Buenas noches!";
  const hasName = !!(datos2.nombre && datos2.nombre !== "");
  const hasLink = !!(datos2.link && datos2.link !== "");
  const hasEmail = !!(datos2.email && datos2.email !== "");
  const opType = (op || "INDEFINIDO").trim().toUpperCase();
  let saludoSugerido = "";
  if (hasLink && !hasName) {
    saludoSugerido = momentoDia + " C\xF3mo est\xE1s? Nico te saluda, lo reviso y te digo... \xBFMe dec\xEDs tu nombre y apellido as\xED te agendo bien?";
  } else if (!hasLink && !hasName) {
    saludoSugerido = momentoDia + " C\xF3mo est\xE1s? Nico te saluda \u{1F44B} \xBFMe podr\xEDas decir tu nombre y apellido as\xED te agendo bien?";
  } else if (hasName && !hasLink) {
    saludoSugerido = momentoDia + ` ${datos2.nombre}, para ayudarte mejor, entr\xE1 en www.faustipropiedades.com.ar y enviame el link de la propiedad que te interese.`;
  }
  let operationalProtocol = "";
  let ejemplosFewShot = "";
  if (opType === "ALQUILAR") {
    const faseIdentificacion = !hasName ? `
    ## Tarea Inmediata (PRIORIDAD ALTA)
    - EL USUARIO ES AN\xD3NIMO. TU \xDANICA PRIORIDAD ES OBTENER SU NOMBRE.
    - NO respondas dudas espec\xEDficas ni ofrezcas visitas hasta tener el nombre.
    
    ***Script Obligatorio***: "${momentoDia}, nico de fausti propiedades por ac\xE1. dale, te ayudo con esa info, \xBFme podr\xEDas decir tu nombre y apellido para agendarte?"
    ` : `
    ## Tarea Inmediata
    - Usuario identificado: ${datos2.nombre}. Contin\xFAa con la calificaci\xF3n.
    `;
    const faseCalificacion = hasName ? `
    2. FASE DE CALIFICACI\xD3N (REQUISITOS DE ALQUILER)
    Ahora que tienes el nombre, filtra al interesado.
    
    <datos_propiedad>
    ${datos2.requisitos ? `- Requisitos exigidos: ${datos2.requisitos}` : ""}
    ${datos2.mascotas ? `- Pol\xEDtica de mascotas: ${datos2.mascotas}` : ""}
    </datos_propiedad>

    <reglas_de_interaccion>
    - ACCI\xD3N 1: Informa al cliente los requisitos y la pol\xEDtica de mascotas bas\xE1ndote estrictamente en los datos_propiedad.
    - RESTRICCI\xD3N (ACCI\xD3N 2): NO muestres ninguna otra caracter\xEDstica de la propiedad a menos que el usuario te pregunte por algo espec\xEDfico.
    - FINANCIAMIENTO: Si el usuario pregunta por financiamiento o cuotas, responde exactamente: "los alquileres no se financian."
    </reglas_de_interaccion>

    <reglas_de_calificacion_y_rechazo>
      1. REQUISITOS FINANCIEROS: El usuario debe contar con garant\xEDa y justificaci\xF3n de ingresos (recibo de sueldo, monotributo, etc.).
      2. SI NO CUMPLE: NO le ofrezcas agendar una visita bajo ninguna circunstancia.
      3. PROTOCOLO DE DERIVACI\xD3N: 
        - Si no cumple los requisitos, dile exactamente: "Entiendo, [Nombre]. En este caso, podr\xEDamos ver si hay alguna otra opci\xF3n que se ajuste a tus posibilidades. \xBFTe gustar\xEDa que te contacte alguien del equipo para explorar alternativas?"
        - Si el usuario responde afirmativamente (ej. "dale", "s\xED", "me parece bien"), **ES OBLIGATORIO que ejecutes INMEDIATAMENTE la herramienta "notificar_equipo"**.
      4. RESPUESTA DE CIERRE: Solo despu\xE9s de que la herramienta "notificar_equipo" te devuelva un estado exitoso, desp\xEDdete diciendo: "\xA1Perfecto! Ya le pas\xE9 tus datos al equipo. Se van a estar comunicando con vos muy pronto \u{1F60A}".
    </reglas_de_calificacion_y_rechazo>
    ` : "";
    operationalProtocol = `
# PROTOCOLO DE ACTUACI\xD3N
Estado: ${!hasName ? "BLOQUEO DE IDENTIDAD" : "CALIFICACI\xD3N ACTIVA"}

${faseIdentificacion}

${faseCalificacion}

Pregunta de Cierre: "la propiedad est\xE1 disponible, \xBFquer\xE9s coordinar una visita?"

IV \u{1F3E0} PROTOCOLO DE ALQUILER
<trigger>
Si el usuario confirma inter\xE9s expl\xEDcito (ej: "quiero verla", "\xBFcu\xE1ndo puedo ir?"), inicia este flujo.
</trigger>

PASO 1: SELECCI\xD3N DE ESTRATEGIA DE AGENDA
Eval\xFAa el \xFAltimo mensaje del usuario y elige UN camino:

OPCI\xD3N A: El usuario NO propone fecha/hora.
- **Acci\xF3n**: Ejecuta "get_available_slots".
- **Respuesta**: Presenta la lista devuelta por la herramienta y pregunta: "\xBFCu\xE1l de estos horarios te queda mejor?".

OPCI\xD3N B: El usuario propone fecha/hora espec\xEDfica (ej: "martes a las 5").
- **Acci\xF3n**: Ejecuta "get_available_schedule" con los par\xE1metros del usuario.
- **Manejo de Respuesta**:
  - Si la herramienta confirma disponibilidad: Procede al PASO 2.
  - Si la herramienta niega disponibilidad: Comunica las alternativas que la herramienta devuelva.


PASO 2: CONFIRMACI\xD3N Y RESERVA (CR\xCDTICO)

<verificacion_datos>
  1. \xBFTienes el "Nombre" y "Apellido"?
  2. \xBFTienes el "Tel\xE9fono"?
</verificacion_datos>

- **Si FALTA alg\xFAn dato**: NO agendes todav\xEDa. Pide el dato faltante amablemente: "Para confirmarte la visita, necesito tu [dato faltante] para el sistema."
  - Una vez que el horario sea validado y aceptado, ejecuta "create_calendar_event".
   - **EXTRACCI\xD3N DE DATOS MANDATORIA**: Obt\xE9n la informaci\xF3n de la secci\xF3n "II. CONTEXTO ACTUAL DEL LEAD":
     - clientName: Combinaci\xF3n de "Nombre" y "Apellido".
     - clientPhone: Campo "Tel\xE9fono".
     - propertyAddress: Campo "Domicilio Propiedad".
     - propertyLink: Campo "Link Propiedad".
     - pendingQuestions: Campo "Preguntas Pendientes".
   - **RESPUESTA FINAL**: "\xA1Perfecto! Ya qued\xF3 agendado. Te env\xEDo el link del evento."

  <manejo_de_consultas>
  1. CONSULTAS DE AGENDA (PRIORIDAD ALTA): Si el usuario menciona d\xEDas de la semana (ej: "viernes", "ma\xF1ana") u horarios, NUNCA digas que no tienes la informaci\xF3n. Ejecuta SIEMPRE la herramienta "get_available_schedule".
  DUDAS DE LA PROPIEDAD: Si el usuario pregunta caracter\xEDsticas de la propiedad que no est\xE1n en el contexto, responde: "No tengo esa informaci\xF3n ahora...".
\u{1F6D1} RESTRICCI\xD3N ABSOLUTA: NUNCA uses la frase "No tengo esa informaci\xF3n" si el mensaje del usuario incluye d\xEDas de la semana (lunes, viernes, hoy, ma\xF1ana) o referencias a tiempo. Si detectas un d\xEDa, tu \xDANICA opci\xF3n es usar la herramienta 'get_available_schedule'.

  2. DUDAS DE LA PROPIEDAD: Si el usuario pregunta caracter\xEDsticas de la propiedad que no est\xE1n en el contexto (ej: expensas, mascotas), responde: "No tengo esa informaci\xF3n ahora, pero si quer\xE9s te la confirmo durante la visita \u{1F60A}".
</manejo_de_consultas>
 `;
    ejemplosFewShot = `
V. EJEMPLOS DE \xC9XITO (FEW-SHOT PARA ALQUILER)

Estos ejemplos muestran c\xF3mo debes pensar y responder. Presta especial atenci\xF3n a la validaci\xF3n de requisitos y al formato de las herramientas.

<examples>

  ### EJEMPLO 1: Flujo Ideal (Diego)
  User: "Hola, vi este depto: https://zonaprop..."
  <thinking>El usuario quiere alquilar. No tengo su nombre en ${datos2.nombre}. Debo aplicar protocolo de BLOQUEO.</thinking>
  Nico: \xA1buenas tardes! nico te saluda, lo reviso y te digo... \xBFme dec\xEDs tu nombre y apellido as\xED te agendo bien?
  User: "Diego Barrueta"
 <thinking>Tengo nombre. Fase de Calificaci\xF3n: Debo mencionar requisitos antes de ofrecer visita.${datos2.mascotas ? " Tambi\xE9n mencionar\xE9 la pol\xEDtica de mascotas." : ""} Los requisitos son ${datos2.requisitos}.</thinking>
  Nico: genial diego! ya te agend\xE9. te comento, los requisitos son ${datos2.requisitos}${datos2.mascotas ? `
Nico: ${datos2.mascotas}` : ""}
  Nico: \xBFcont\xE1s con eso? si es as\xED, \xBFquer\xE9s coordinar una visita?
  User: "S\xED, quiero ir a verla"
  <thinking>El usuario cumple requisitos y no dio fecha exacta. Debo consultar disponibilidad general usando la herramienta 'get_available_slots'.</thinking>

  [SISTEMA: Tool Output get_available_slots]
  {
    "slots": ["2023-10-22T12:30:00Z", "2023-10-22T16:30:00Z", "2023-10-23T10:00:00Z"],
    "formatted_text": "Jueves 22: 12:30, 16:30. Viernes 23: 10:00"
  }
  Nico: Tengo los siguientes horarios disponibles para la visita:

  Jueves 22:
  - 12:30 hs
  - 16:30 hs

  Viernes 23:
  - 10:00 hs

  \xBFAlguno de estos horarios te viene bien?
  User: "El Jueves a las 16:30 me va bien"
  <thinking>Usuario confirma horario. Pido email antes de ejecutar la reserva final para enviar el link del evento.</thinking>
  Nico: perfecto, ya te anot\xE9 para el jueves a las 16:30 hs. \xBFme pas\xE1s un email por favor?
  User: dale, diego@diego.com
  <thinking>Tengo todos los datos. Ejecuto 'create_calendar_event'.</thinking>
  [SISTEMA: Tool Output create_calendar_event]
  {
    "status": "success",
    "eventId": "evt_98765",
    "link": "https://calendar.google.com/calendar/event?action=TEMPLATE&..."
  }
  Nico: genial diego! gracias!
  te envio el link del evento https://calendar.google.com/calendar/event?action=TEMPLATE&...


  ### EJEMPLO 2: Flujo con duda pendiente
  User: "\xBFAceptan mascotas? \xBFY tiene cochera?"
  <thinking>
  - Busco en la informaci\xF3n de la propiedad en ${datos2.propiedadInfo}
  - Cochera: S\xED, tiene cochera fija.
  - Mascotas: ${datos2.mascotas ? "El dato dice: " + datos2.mascotas : "No tengo el dato exacto ahora."}
  - Como me falta confirmar un dato, uso la frase de duda pendiente.
  </thinking>
  Nico: tiene cochera fija. ${datos2.mascotas || "lo de las mascotas no lo tengo ac\xE1 ahora, pero si quer\xE9s te lo confirmo durante la visita \u{1F44C}"} \xBFte gustar\xEDa ir a verla?
  User: "Dale, el jueves a las 10hs"
  <thinking>El usuario confirma. Debo llamar a 'create_calendar_event' (o a la herramienta de disponibilidad primero) incluyendo ["\xBFAceptan mascotas?"] en 'pendingQuestions'.</thinking>

  ### EJEMPLO 3: Usuario consulta disponibilidad sobre un d\xEDa espec\xEDfico
  Cliente: "tenes disponibilidad el jueves 26?"
  <thinking>El usuario est\xE1 preguntando por un d\xEDa espec\xEDfico para visitar. ESTO NO ES UNA DUDA DE LA PROPIEDAD. Debo ejecutar la herramienta 'get_available_schedule' con intent="SPECIFIC_DAY" y targetDay="JUEVES".</thinking>
  [SISTEMA: Tool Output get_available_schedule]
  {
    "disponible": true,
    "horarios": ["10:00 a.m.", "2:00 p.m."]
  }
  Nico: \xA1Claro! El jueves 26 tengo disponibilidad en estos horarios:

  - 10:00 a.m.
  - 2:00 p.m.

  \xBFTe gustar\xEDa coordinar una visita?
  
  ### EJEMPLO 4: Usuario propone d\xEDa de forma coloquial
  Cliente: "mepa que me va a quedar mejor, el viernes. tenes alg\xFAn horario disponible para ese d\xEDa?"
  <thinking>El usuario menciona "el viernes". Esto es una consulta de agenda (PRIORIDAD ALTA), ESTO NO ES UNA DUDA DE LA PROPIEDAD. Debo usar 'get_available_schedule' con targetDay="VIERNES".</thinking>
  [SISTEMA: Tool Output get_available_schedule]
  { "disponible": true, "horarios": ["10:00 a.m.", "1:00 p.m."] }
  Nico: \xA1Dale! Para el viernes tengo a las 10:00 a.m. o a la 1:00 p.m., \xBFcu\xE1l prefer\xEDs? \u{1F60A}

  ### EJEMPLO 5: Usuario no cumple requisitos y es derivado
  User: "no cumplo con los requisitos"
  <thinking>
  El usuario no cumple con los requisitos para alquilar. 
  Debo aplicar el protocolo de derivaci\xF3n y preguntarle si quiere que un humano lo contacte.
  </thinking>
  Nico: Entiendo, ${datos2.nombre}. En este caso, podr\xEDamos ver si hay alguna otra opci\xF3n que se ajuste a tus posibilidades. \xBFTe gustar\xEDa que te contacte alguien del equipo para explorar alternativas?
  User: "dale"
  <thinking>
  El usuario acept\xF3 ser contactado. Debo ejecutar la herramienta 'notificar_equipo' con su nombre y el motivo.  
  </thinking>
  [SISTEMA: Tool Output notificar_equipo]
  {
    "status": "success"
  }
  Nico: \xA1Perfecto ${datos2.nombre}! Ya le pas\xE9 tus datos al equipo. Se van a estar comunicando con vos muy pronto.
  
  ### EJEMPLO 6: Usuario pregunta por otro d\xEDa con lenguaje informal
  Cliente: "para el viernes tenes algo?? , me queda mejor"
  <thinking>El usuario menciona "viernes" y pregunta si "tengo algo". Esto es una consulta de agenda (PRIORIDAD ALTA), NO una caracter\xEDstica de la propiedad. NUNCA debo decir que no tengo la informaci\xF3n. Debo ejecutar 'get_available_schedule' con targetDay="VIERNES".</thinking>
  [SISTEMA: Tool Output get_available_schedule]
  { "disponible": false, "horarios_alternativos": ["lunes a las 10:00 a.m."] }
  Nico: Para el viernes ya no me quedan lugares, pero \xBFte servir\xEDa el lunes a las 10:00 a.m.? \u{1F60A}


</examples>
`;
  } else if (opType === "VENDER") {
    operationalProtocol = `
III. PROTOCOLO OPERATIVO (FLUJO OBLIGATORIO)
1. FASE DE IDENTIFICACI\xD3N (BLOQUEO)
Estado Actual: ${hasName ? "Nombre conocido: " + datos2.nombre : "Nombre desconocido"}

Regla Estricta: Si el nombre es desconocido, tu \xFAnica misi\xF3n es obtenerlo. No hables de la propiedad, ni de requisitos, ni de horarios.

Acci\xF3n: ${momentoDia} ", nico de fausti propiedades por ac\xE1. dale, te ayudo con esa info, \xBFme podr\xEDas decir tu nombre y apellido para agendarte?"

"Perfecto ${datos2.nombre}, est\xE1 disponible para visitar. Quer\xE9s que coordinemos una visita?"

IV \u{1F3E0} PROTOCOLO DE VENTA
1. Si el usuario confirma que quiere verla.

2. **Acci\xF3n INMEDIATA**: NO PREGUNTES. EJECUTA: **potential_sale_email**

3. **Cierre**: "Genial, en el transcurso del d\xEDa te vamos a estar contactando para coordinar la visita. Muchas gracias ${datos2.nombre || ""} \u{1F60A}"

# V. EJEMPLOS DE \xC9XITO (FEW-SHOT)

### EJEMPLO 1: Nombre Desconocido (Bloqueo)
User: "Hola, vi esta propiedad: https://zonaprop..."
Pensamiento: El usuario quiere comprar. No tengo su nombre. Protocolo de bloqueo activo.
Nico: \xA1buenas tardes! nico de fausti propiedades por ac\xE1. dale, te ayudo con esa info, \xBFme podr\xEDas decir tu nombre y apellido para agendarte?

### EJEMPLO 2: Nombre Conocido -> Ofrecer Visita
User: "Soy Juan P\xE9rez."
Pensamiento: Ya tengo el nombre. Debo confirmar disponibilidad y ofrecer visita.
Nico: Perfecto Juan P\xE9rez, est\xE1 disponible para visitar. Quer\xE9s que coordinemos una visita?

### EJEMPLO 3: Coordinaci\xF3n de Visita -> Cierre
User: "S\xED, quiero ir a verla"
Pensamiento: El usuario quiere verla. Ejecuto 'potential_sale_email' y cierro la conversaci\xF3n seg\xFAn protocolo.
[SISTEMA: Ejecuta tool 'potential_sale_email']
Nico: Genial, en el transcurso del d\xEDa te vamos a estar contactando para coordinar la visita. Muchas gracias Juan P\xE9rez \u{1F60A} `;
    ejemplosFewShot = "";
  }
  let cierre = "";
  if (opType === "ALQUILAR") {
    cierre = `
  # VI. CIERRE DE CONVERSACI\xD3N
  - Si agradece: "Gracias a vos ${datos2.nombre}. Cualquier cosa me escrib\xEDs."
  - Si se despide: "Que tengas muy buen d\xEDa ${datos2.nombre} \u{1F44B}"

    `;
  } else if (opType === "VENDER") {
    cierre = `
  # VI. CIERRE DE CONVERSACI\xD3N
  - **Respuesta**: "Genial, en el transcurso del d\xEDa te vamos a estar contactando para coordinar la visita. Muchas gracias ${datos2.nombre || ""} \u{1F60A}"
    `;
  }
  return `
# I. IDENTIDAD & ROL
Eres NICO, asistente de IA de Fausti Propiedades. Inmobiliaria de Lomas de Zamora, buenos Aires, Argentina.

## \u{1F4F1} ESTILO DE COMUNICACI\xD3N (WHATSAPP MODE)
Act\xFAa como una persona real escribiendo r\xE1pido por WhatsApp:
- **FORMATO**: Usa min\xFAsculas casi siempre. Evita puntos finales en oraciones cortas.
- **TONO**: Calido, Profesional, Casual, emp\xE1tico, directo ("vos", "dale", "genial").
- **EMOJIS**: Pocos, solo si suma onda (1 o 2 max).
- **PROHIBICI\xD3N ABSOLUTA**: No menciones errores t\xE9cnicos, fallos de an\xE1lisis, o falta de informaci\xF3n. No digas "lo siento", "no pude", "estoy teniendo problemas".
- **SILENCIO POSITIVO**: Si un dato no est\xE1 en el texto o si la herramienta de an\xE1lisis devuelve un error, **OMITE** esa l\xEDnea por completo. No digas "no especificado", no digas "lo siento".
- **PROHIBIDO**: No seas rob\xF3tico. No uses "Estimado", "Quedo a la espera", "Cordialmente".
- **CLIVAJES**: Si tienes que decir varias cosas, usa oraciones breves y directas.

## Reglas Operativas
- **L\xEDmite de Informaci\xF3n**: SOLO puedes hablar sobre la informaci\xF3n que tienes en "Informaci\xF3n Propiedad" y "CONTEXTO ACTUAL DEL LEAD". NO inventes ni asumas datos.
- **Respuesta Faltante**: Si te consultan por algo que no est\xE1 en la informaci\xF3n provista, DEBES responder exactamente: "No tengo esa informaci\xF3n ahora, pero si quer\xE9s te la confirmo durante la visita \u{1F44C}"
**Registro**: Debes recordar internamente esa pregunta para incluirla en el campo ${datos2.pendingQuestions} cuando ejecutes 'create_calendar_event'.
- **Privacidad**:
  1. TERCEROS: JAM\xC1S reveles datos de otros.
  2. USUARIO: Si pregunta "\xBFQu\xE9 sabes de m\xED?", responde SOLO con lo que ves en "DATOS ACTUALES".
  3. Si te piden informaci\xF3n que no corresponde revelar, respond\xE9: "No tengo acceso a esa informaci\xF3n."

# II. CONTEXTO ACTUAL DEL LEAD
- **Nombre**: ${datos2.nombre || "Desconocido"}
- **Apellido**: ${datos2.apellido || "Desconocido"}
- **Email**: ${datos2.email || "Pendiente"}
- **Tel\xE9fono**: ${datos2.telefono || "Pendiente"}
- **Link Propiedad**: ${datos2.link || "Pendiente"}
- **Operaci\xF3n**: ${opType}
- **Domicilio Propiedad**: ${datos2.propertyAddress || "Pendiente"}
- **Informaci\xF3n Propiedad**: ${datos2.propiedadInfo || "Pendiente"} 
- **Mascotas**: ${datos2.mascotas || ""}
- **Requisitos**: ${datos2.requisitos || ""}
- **Preguntas Pendientes**: ${datos2.pendingQuestions || "Ninguna"}

${operationalProtocol}

${ejemplosFewShot}

# SALUDO INICIAL (Solo si es el primer mensaje):
"${saludoSugerido}"

- Fecha actual: ${(/* @__PURE__ */ new Date()).toLocaleDateString("es-AR")}
`;
};

"use strict";
const extractAddressInputSchema = z.object({
  url: z.string().url()
});
const extractAddressOutputSchema = z.object({
  filters: z.array(z.tuple([z.string(), z.string(), z.string()])),
  current_localization_type: z.string(),
  current_localization_id: z.number(),
  price_from: z.number(),
  price_to: z.number(),
  operation_types: z.array(z.number()),
  property_types: z.array(z.number())
});
const extractAddressStep = createStep({
  id: "extract-address",
  inputSchema: extractAddressInputSchema,
  outputSchema: extractAddressOutputSchema,
  execute: async ({ inputData }) => {
    console.log("\u{1F4CD} [Step: extract-address] Starting with URL:", inputData.url);
    const result = await extractAddressFromUrlTool.execute({
      url: inputData.url
    });
    if (!("filters" in result)) {
      console.error("\u274C [Step: extract-address] Failed:", result);
      throw new Error("Failed to extract address filters");
    }
    console.log("\u2705 [Step: extract-address] Completed. Address:", result.filters[0]);
    return result;
  }
});
const tokkoSearchInputSchema = z.object({
  filters: z.array(z.tuple([z.string(), z.string(), z.string()])),
  current_localization_type: z.string(),
  current_localization_id: z.number(),
  price_from: z.number(),
  price_to: z.number(),
  operation_types: z.array(z.number()),
  property_types: z.array(z.number())
});
const tokkoSearchOutputSchema = z.object({
  success: z.boolean(),
  data: z.any(),
  // Using any to avoid complex schema duplication here, validated in tool
  error: z.string().optional()
});
const tokkoSearchStep = createStep({
  id: "tokko-search",
  inputSchema: tokkoSearchInputSchema,
  outputSchema: tokkoSearchOutputSchema,
  execute: async ({ inputData }) => {
    console.log("\u{1F4CD} [Step: tokko-search] Starting search with filters:", JSON.stringify(inputData.filters));
    const result = await tokkoPropertySearchTool.execute(inputData);
    if (!("data" in result)) {
      console.error("\u274C [Step: tokko-search] Failed:", result);
      throw new Error("Failed to search properties");
    }
    const count = result.data?.objects?.length || 0;
    console.log(`\u2705 [Step: tokko-search] Completed. Found ${count} properties.`);
    return result;
  }
});
const extractRequirementsInputSchema = z.object({
  success: z.boolean(),
  data: z.any(),
  error: z.string().optional()
});
const extractRequirementsOutputSchema = z.object({
  formattedText: z.string(),
  rawProperty: z.any()
});
const extractRequirementsStep = createStep({
  id: "extract-requirements",
  inputSchema: extractRequirementsInputSchema,
  outputSchema: extractRequirementsOutputSchema,
  execute: async ({ inputData }) => {
    console.log("\u{1F4CD} [Step: extract-requirements] Starting analysis on property data...");
    if (!inputData.success || !inputData.data?.objects || inputData.data.objects.length === 0) {
      console.error("\u274C [Step: extract-requirements] Validation Failed: No properties found.");
      throw new Error("No property found in Tokko search");
    }
    const property = inputData.data.objects[0];
    const description = property.rich_description || property.description || "";
    console.log(`\u2139\uFE0F [Step: extract-requirements] Property ID: ${property.id}, Description Length: ${description.length}`);
    console.log("   [Workflow] Extracting requirements from description...");
    const formatterResult = await realEstatePropertyFormatterTool.execute({
      keywordsZonaProp: description
    });
    if (!("formattedText" in formatterResult)) {
      console.error("\u274C [Step: extract-requirements] Validation Failed:", formatterResult);
      throw new Error("Failed to extract requirements");
    }
    console.log("\u2705 [Step: extract-requirements] Completed analysis.");
    return {
      formattedText: formatterResult.formattedText,
      rawProperty: property
    };
  }
});
const transformOutputInputSchema = z.object({
  formattedText: z.string(),
  rawProperty: z.any()
});
const transformOutputOutputSchema = z.object({
  propiedadInfo: z.string(),
  operacionTipo: z.enum(["ALQUILAR", "VENDER", ""]),
  address: z.string(),
  mascotas: z.string(),
  requisitos: z.string()
});
const transformOutputStep = createStep({
  id: "transform-output",
  inputSchema: transformOutputInputSchema,
  outputSchema: transformOutputOutputSchema,
  execute: async ({ inputData }) => {
    console.log("\u{1F4CD} [Step: transform-output] Starting transformation...");
    const property = inputData.rawProperty;
    const rawFormattedText = inputData.formattedText;
    let requisitos = "No especificado";
    let mascotas = "No especificado";
    const reqMatch = rawFormattedText.match(
      /Requisitos:\s*([\s\S]*?)(?=\n\s*Mascotas:|$)/i
    );
    if (reqMatch) requisitos = reqMatch[1].trim();
    const petsMatch = rawFormattedText.match(/Mascotas:\s*([\s\S]*)/i);
    if (petsMatch) mascotas = petsMatch[1].trim();
    let operacionTipo = "";
    const ops = property.operations || [];
    const isVenta = ops.some((op) => op.operation_type === "Venta");
    const isAlquiler = ops.some((op) => op.operation_type === "Alquiler");
    if (isAlquiler) operacionTipo = "ALQUILAR";
    else if (isVenta) operacionTipo = "VENDER";
    else if (ops.length > 0)
      operacionTipo = ops[0].operation_type === "Venta" ? "VENDER" : "ALQUILAR";
    const propiedadInfo = property.description || property.description_only || "";
    const address = property.address || "";
    console.log("\u2705 [Step: transform-output] Completed. Final Operation Type:", operacionTipo);
    return {
      propiedadInfo,
      operacionTipo,
      address,
      mascotas,
      requisitos
    };
  }
});
const propertyWorkflow = createWorkflow({
  id: "property-intelligence-pipeline",
  inputSchema: z.object({
    url: z.string().url()
  }),
  outputSchema: z.object({
    propiedadInfo: z.string(),
    operacionTipo: z.enum(["ALQUILAR", "VENDER", ""]),
    address: z.string(),
    mascotas: z.string(),
    requisitos: z.string()
  })
}).then(extractAddressStep).then(tokkoSearchStep).then(extractRequirementsStep).then(transformOutputStep).commit();

"use strict";
const sleep = async (seconds) => {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1e3));
};

"use strict";
await storage.init();
const realEstateAgent = await getRealEstateAgent("");
const activeProcessing = /* @__PURE__ */ new Set();
const sessionOperationMap = /* @__PURE__ */ new Map();
const sessionLinkMap = /* @__PURE__ */ new Map();
const sessionPropiedadInfoMap = /* @__PURE__ */ new Map();
const mastra = new Mastra({
  storage,
  vectors: {
    vectorStore
  },
  agents: {
    realEstateAgent,
    realEstateCleaningAgent,
    addressExtractionAgent
  },
  tools: {
    realEstatePropertyFormatterTool,
    tokkoPropertySearchTool,
    extractAddressFromUrlTool
  },
  workflows: {
    propertyWorkflow
  },
  server: {
    port: 4111,
    apiRoutes: [registerApiRoute("/chat", {
      method: "POST",
      handler: async (c) => {
        try {
          const body = await c.req.json();
          let message = body.custom_fields.endResponse;
          let whatsappPhone = body.whatsapp_phone;
          let threadId = body.id;
          let userId = body.id;
          let clientData = {};
          if (whatsappPhone) {
            clientData.telefono = whatsappPhone;
          }
          console.log("\n\u{1F525}\u{1F525}\u{1F525} INICIO DEL REQUEST \u{1F525}\u{1F525}\u{1F525}");
          if (!threadId && !userId) {
            return c.json({
              error: "Either ThreadID or UserID is required"
            }, 400);
          }
          const currentThreadId = threadId || `chat_${userId}`;
          const urlRegex = /(https?:\/\/[^\s]+)/g;
          const linksEncontrados = message?.match(urlRegex);
          const requestHash = `${userId || "anon"}_${message?.substring(0, 300)}`;
          if (activeProcessing.has(requestHash)) {
            return c.json({
              status: "ignored_duplicate"
            });
          }
          activeProcessing.add(requestHash);
          setTimeout(() => activeProcessing.delete(requestHash), 15e3);
          let ackResponse = void 0;
          if (userId && body.custom_fields) {
            ackResponse = c.json({
              response_text: "",
              // Texto vacío para que Manychat no muestre nada y espere el Push
              status: "processing"
            });
          }
          (async () => {
            try {
              let finalContextData = {};
              finalContextData.telefono = whatsappPhone;
              let propertyOperationType = sessionOperationMap.get(currentThreadId) || "";
              finalContextData.operacionTipo = propertyOperationType;
              try {
                if (clientData && Object.keys(clientData).length > 0) {
                  const validResourceId = userId || "anonymous_user";
                  await ThreadContextService.updateContext(threadId, validResourceId, clientData);
                }
                const dbContext = await ThreadContextService.getContext(threadId);
                const mastraProfile = await ThreadContextService.getResourceProfile(userId);
                finalContextData = {
                  ...mastraProfile,
                  // 1. Base (Mastra)
                  ...dbContext,
                  // 2. Contexto Thread
                  ...clientData || {}
                  // 3. Override actual
                };
                if (!propertyOperationType && finalContextData.operacionTipo) {
                  propertyOperationType = finalContextData.operacionTipo;
                  sessionOperationMap.set(currentThreadId, propertyOperationType);
                }
              } catch (err) {
                console.error("\u26A0\uFE0F Error gestionando contexto en DB (usando fallback):", err);
                finalContextData = clientData || {};
              }
              if (!finalContextData.link && sessionLinkMap.has(currentThreadId)) {
                finalContextData.link = sessionLinkMap.get(currentThreadId);
              } else if (finalContextData.link && !sessionLinkMap.has(currentThreadId)) {
                sessionLinkMap.set(currentThreadId, finalContextData.link);
              }
              if (!finalContextData.propiedadInfo && sessionPropiedadInfoMap.has(currentThreadId)) {
                finalContextData.propiedadInfo = sessionPropiedadInfoMap.get(currentThreadId);
              } else if (finalContextData.propiedadInfo && !sessionPropiedadInfoMap.has(currentThreadId)) {
                sessionPropiedadInfoMap.set(currentThreadId, finalContextData.propiedadInfo);
              }
              if (linksEncontrados && linksEncontrados.length > 0) {
                const url = linksEncontrados[0].trim();
                finalContextData.link = url;
                sessionLinkMap.set(currentThreadId, url);
                if (currentThreadId) {
                  await ThreadContextService.clearThreadMessages(currentThreadId);
                  sessionOperationMap.delete(currentThreadId);
                  sessionPropiedadInfoMap.delete(currentThreadId);
                  finalContextData.operacionTipo = "";
                  finalContextData.propiedadInfo = "";
                  await ThreadContextService.updateContext(threadId, userId || "anon", {
                    operacionTipo: "",
                    propiedadInfo: "",
                    link: url
                  });
                }
                try {
                  const workflow = mastra.getWorkflow("propertyWorkflow");
                  const run = await workflow.createRun();
                  const result = await run.start({
                    inputData: {
                      url
                    }
                  });
                  if (result.status !== "success") {
                    console.error(`\u274C Workflow failed: ${result.status}`);
                  } else if (result.result) {
                    const outputLogica = result.result;
                    if (outputLogica.operacionTipo) {
                      propertyOperationType = outputLogica.operacionTipo;
                      finalContextData.operacionTipo = outputLogica.operacionTipo;
                      finalContextData.propertyAddress = outputLogica.address;
                      finalContextData.propiedadInfo = outputLogica.propiedadInfo || "Sin descripci\xF3n disponible";
                      finalContextData.mascotas = outputLogica.mascotas;
                      finalContextData.requisitos = outputLogica.requisitos;
                      sessionOperationMap.set(currentThreadId, propertyOperationType);
                      sessionPropiedadInfoMap.set(currentThreadId, finalContextData.propiedadInfo);
                      const validResourceId = userId || "anonymous_user";
                      await ThreadContextService.updateContext(threadId, validResourceId, {
                        operacionTipo: propertyOperationType,
                        propiedadInfo: finalContextData.propiedadInfo,
                        link: url
                      });
                    }
                  }
                } catch (workflowErr) {
                  console.error("\u274C Workflow error:", workflowErr);
                }
              }
              const contextoAdicional = dynamicInstructions(finalContextData, propertyOperationType.toUpperCase());
              const agent = await getRealEstateAgent(userId, contextoAdicional, finalContextData.operacionTipo);
              const response = await agent.generate(message, {
                threadId: currentThreadId,
                resourceId: userId
              });
              if (response.toolResults && response.toolResults.length > 0) {
                response.toolResults.forEach((toolRes) => {
                  if (toolRes.status === "error" || toolRes.error) {
                    console.error(`\u274C [ERROR CR\xCDTICO POST-EXEC] Tool '${toolRes.toolName}' fall\xF3:`);
                    console.error(`   Motivo:`, JSON.stringify(toolRes.error || toolRes.result, null, 2));
                  }
                });
              }
              if (userId && body.custom_fields) {
                const parts = response.text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
                for (const part of parts) {
                  await sendToManychat(userId, part);
                  if (parts.length > 1) {
                    const randomDelay = Math.floor(Math.random() * (10 - 2 + 1)) + 2;
                    await sleep(randomDelay);
                  }
                }
              }
            } catch (bgError) {
              console.error("\u{1F4A5} Error en proceso background:", bgError);
              if (userId && body.custom_fields) {
                await sendToManychat(userId, "Lo siento, tuve un error t\xE9cnico analizando esa informaci\xF3n.");
              }
            } finally {
            }
          })();
          if (ackResponse) {
            return ackResponse;
          }
          return c.json({
            status: "started_background_job"
          });
          if (ackResponse) {
            return ackResponse;
          }
          return c.json({
            status: "started_background_job"
          });
        } catch (error) {
          console.error("\u{1F4A5} Error general en el handler:", error);
          return c.json({
            error: "Internal Server Error"
          }, 500);
        }
      }
    })]
  }
});
async function sendToManychat(subscriberId, text) {
  const apiKey = "3448431:145f772cd4441c32e7a20cfc6d4868f6";
  const headers = {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
  try {
    const setFieldRes = await axios.post("https://api.manychat.com/fb/subscriber/setCustomFields", {
      subscriber_id: Number(subscriberId),
      // Ensure number if needed, though string often works. API docs say subscriber_id: 0 (schema), so number usually.
      fields: [{
        field_name: "response1",
        field_value: text
      }]
    }, {
      headers
    });
    await sleep(2);
    const sendFlowRes = await axios.post("https://api.manychat.com/fb/sending/sendFlow", {
      subscriber_id: Number(subscriberId),
      flow_ns: "content20250919131239_298410"
    }, {
      headers
    });
  } catch (err) {
    console.error("\u274C Error interacting with Manychat:", JSON.stringify(err.response?.data || err.message, null, 2));
  }
}

async function runMigration() {
      const storage = mastra.getStorage();

      if (!storage) {
        console.log(JSON.stringify({
          success: false,
          alreadyMigrated: false,
          duplicatesRemoved: 0,
          message: 'Storage not configured. Please configure storage in your Mastra instance.',
        }));
        process.exit(1);
      }

      // Access the observability store directly from storage.stores
      const observabilityStore = storage.stores?.observability;

      if (!observabilityStore) {
        console.log(JSON.stringify({
          success: false,
          alreadyMigrated: false,
          duplicatesRemoved: 0,
          message: 'Observability storage not configured. Migration not required.',
        }));
        process.exit(0);
      }

      // Check if the store has a migrateSpans method
      if (typeof observabilityStore.migrateSpans !== 'function') {
        console.log(JSON.stringify({
          success: false,
          alreadyMigrated: false,
          duplicatesRemoved: 0,
          message: 'Migration not supported for this storage backend.',
        }));
        process.exit(1);
      }

      try {
        // Run the migration - migrateSpans handles everything internally
        const result = await observabilityStore.migrateSpans();

        console.log(JSON.stringify({
          success: result.success,
          alreadyMigrated: result.alreadyMigrated,
          duplicatesRemoved: result.duplicatesRemoved,
          message: result.message,
        }));

        process.exit(result.success ? 0 : 1);
      } catch (error) {
        console.log(JSON.stringify({
          success: false,
          alreadyMigrated: false,
          duplicatesRemoved: 0,
          message: error instanceof Error ? error.message : 'Unknown error during migration',
        }));
        process.exit(1);
      }
    }

    runMigration();
