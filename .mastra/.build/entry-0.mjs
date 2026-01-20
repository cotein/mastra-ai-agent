import 'dotenv/config';
import { Mastra } from '@mastra/core';
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { openai } from '@ai-sdk/openai';
import { PostgresStore, PgVector } from '@mastra/pg';
import { Pool } from 'pg';
import { SystemPromptScrubber, PromptInjectionDetector, ModerationProcessor, TokenLimiter } from '@mastra/core/processors';
import { generateText, generateObject } from 'ai';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { google } from 'googleapis';
import { es } from 'chrono-node';
import { isValid, addDays, startOfDay, setHours, setMinutes, setSeconds, setMilliseconds, formatISO } from 'date-fns';
import axios from 'axios';

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
        model: openai("gpt-4o-mini"),
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
        model: openai("gpt-4o-mini"),
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
  description: "Registra citas de visitas inmobiliarias en el calendario oficial de Fausti. Esta herramienta DEBE ser usada cuando el cliente confirma un horario.",
  inputSchema: z.object({
    title: z.string().optional().describe("T\xEDtulo descriptivo del evento"),
    start: z.string().describe('Fecha y hora de inicio. Puede ser formato ISO8601 O texto natural (ej: "Lunes 20 a las 10hs", "Ma\xF1ana 15:00").'),
    end: z.string().optional().describe("Fecha y hora de fin. Puede ser formato ISO8601 O texto natural."),
    clientName: z.string().optional().describe("Nombre y Apellido del cliente"),
    clientPhone: z.string().optional().describe("Tel\xE9fono del cliente"),
    propertyAddress: z.string().optional().describe("Direcci\xF3n de la propiedad"),
    propertyLink: z.string().optional().describe("Link de la propiedad")
  }),
  execute: async (input) => {
    console.log("\u{1F6E0}\uFE0F [TOOL START] create_calendar_event iniciado");
    console.log("\u{1F4CA} [PARAMS] Par\xE1metros recibidos del agente:", JSON.stringify(input, null, 2));
    const calendar = getGoogleCalendar();
    const calendarId = CALENDAR_ID;
    try {
      let smartStart;
      let smartEnd;
      const isIsoStart = !isNaN(Date.parse(input.start)) && input.start.includes("T");
      if (isIsoStart) {
        console.log("\u26A1 [FAST PATH] Detectado formato ISO. Saltando LLM Parser.");
        smartStart = input.start;
        if (input.end && !isNaN(Date.parse(input.end)) && input.end.includes("T")) {
          smartEnd = input.end;
        } else {
          const startDate = new Date(smartStart);
          startDate.setHours(startDate.getHours() + 1);
          smartEnd = startDate.toISOString();
        }
      } else {
        console.log("\u{1F422} [SLOW PATH] Detectado lenguaje natural. Invocando LLM Parser...");
        const dateDescription = input.end ? `Inicio: ${input.start}. Fin: ${input.end}` : input.start;
        const parseResult = await llmDateParser.execute({ dateDescription });
        if (!parseResult.success || !parseResult.start) {
          throw new Error(`No pude entender la fecha: ${parseResult.error || "error desconocido"}`);
        }
        smartStart = parseResult.start;
        smartEnd = parseResult.end;
      }
      const { start, end } = getSanitizedDates(smartStart, smartEnd);
      const eventSummary = input.title || `Visita Propiedad - ${input.clientName}`;
      const description = `visita propiedad - cliente: ${input.clientName} - tel: ${input.clientPhone || "Sin tel"} - Domicilio: ${input.propertyAddress} - Link: ${input.propertyLink || "Sin link"}`;
      const response = await calendar.events.insert({
        calendarId,
        requestBody: {
          summary: eventSummary,
          location: input.propertyAddress,
          description,
          start: {
            dateTime: start,
            // Ya viene formato "YYYY-MM-DDTHH:mm:ss" correcta para la TZ
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
        scheduledStart: start,
        message: "Cita agendada correctamente con formato estandarizado."
      };
    } catch (error) {
      console.error("\u274C [ERROR FATAL] Error creando evento en Google Calendar:", error);
      if (error.response) {
        console.error("\u{1F4E6} [GOOGLE API ERROR DATA]:", JSON.stringify(error.response.data, null, 2));
      }
      return {
        success: false,
        error: error.message,
        details: error.response ? error.response.data : "Error desconocido",
        rawError: JSON.stringify(error, Object.getOwnPropertyNames(error))
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
  description: "Obtiene slots de horarios disponibles de 10:00 a 16:00 para los pr\xF3ximos 5 d\xEDas, excluyendo fines de semana.",
  inputSchema: z.object({}),
  execute: async () => {
    console.log("\u{1F6E0}\uFE0F [TOOL START] get_available_slots iniciado");
    try {
      const calendar = getGoogleCalendar();
      const now = /* @__PURE__ */ new Date();
      const daysToCheck = 5;
      const workStartHour = 10;
      const workEndHour = 16;
      const slotDurationMinutes = 40;
      const bufferMinutes = 30;
      const availableSlots = [];
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
        dayStart.setHours(workStartHour, 0, 0, 0);
        const dayEnd = new Date(currentDate);
        dayEnd.setHours(workEndHour, 0, 0, 0);
        let timeCursor = new Date(dayStart);
        try {
          const response = await calendar.events.list({
            calendarId: CALENDAR_ID,
            timeMin: dayStart.toISOString(),
            timeMax: dayEnd.toISOString(),
            singleEvents: true,
            orderBy: "startTime"
          });
          const events = response.data.items || [];
          while (timeCursor < dayEnd) {
            const proposedEnd = new Date(timeCursor.getTime() + slotDurationMinutes * 6e4);
            if (proposedEnd > dayEnd) break;
            const hasConflict = events.some((event) => {
              if (!event.start.dateTime || !event.end.dateTime) return false;
              const eventStart = new Date(event.start.dateTime);
              const eventEnd = new Date(event.end.dateTime);
              const busyStartWithBuffer = new Date(eventStart.getTime() - bufferMinutes * 6e4);
              const busyEndWithBuffer = new Date(eventEnd.getTime() + bufferMinutes * 6e4);
              return timeCursor >= busyStartWithBuffer && timeCursor < busyEndWithBuffer || proposedEnd > busyStartWithBuffer && proposedEnd <= busyEndWithBuffer || timeCursor <= busyStartWithBuffer && proposedEnd >= busyEndWithBuffer;
            });
            if (!hasConflict) {
              availableSlots.push({
                fecha: timeCursor.toLocaleDateString("es-AR", { weekday: "long", day: "numeric" }),
                hora: timeCursor.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }),
                iso: timeCursor.toISOString()
              });
              timeCursor = new Date(timeCursor.getTime() + 60 * 6e4);
            } else {
              timeCursor = new Date(timeCursor.getTime() + 15 * 6e4);
            }
          }
        } catch (error) {
          console.error(`\u26A0\uFE0F Error fetching events for ${currentDate.toISOString()}:`, error);
        }
      }
      console.log(`\u2705 [TOOL END] get_available_slots finalizado. Slots encontrados: ${availableSlots.length}`);
      return availableSlots.slice(0, 5);
    } catch (criticalError) {
      console.error("\u274C [CRITICAL ERROR] get_available_slots fall\xF3 fatalmente:", criticalError);
      return {
        success: false,
        error: criticalError.message,
        details: "Hubo un error interno consultando disponibilidad. Por favor intenta m\xE1s tarde."
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
const getGmail$1 = () => {
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
    const gmail = getGmail$1();
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
    const gmail = getGmail$1();
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
const getGmail = () => {
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
    const gmail = getGmail();
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
      return gmail.users.messages.send({
        userId: "me",
        requestBody: { raw: encodedMessage }
      });
    });
    try {
      await Promise.all(sendPromises);
    } catch (err) {
      console.error("Error enviando mails de venta:", err);
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
const DEFAULT_SYSTEM_PROMPT = `Eres un asistente inmobiliario de Mastra. Esperando instrucciones de contexto...`;
const getRealEstateAgent = async (userId, instructionsInjected, operacionTipo) => {
  const memory = new Memory({
    storage,
    vector: vectorStore,
    embedder: openai.embedding("text-embedding-3-small"),
    options: {
      lastMessages: 22,
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
  const selectedTools = op === "ALQUILAR" ? { get_available_slots: getAvailableSlots, create_calendar_event: createCalendarEvent, find_event_by_natural_date: findEventByNaturalDate, update_calendar_event: updateCalendarEvent, delete_calendar_event: deleteCalendarEvent } : op === "VENDER" ? { potential_sale_email: potentialSaleEmailTool } : {};
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
    model: openai("gpt-4o"),
    memory,
    tools: selectedTools,
    inputProcessors: [
      new PromptInjectionDetector({
        model: openai("gpt-4o-mini"),
        threshold: 0.8,
        strategy: "block"
      }),
      new ModerationProcessor({
        model: openai("gpt-4o-mini"),
        threshold: 0.7,
        strategy: "block"
      }),
      new TokenLimiter(3e3)
    ],
    outputProcessors: [
      new SystemPromptScrubber({
        model: openai("gpt-4o-mini"),
        strategy: "redact",
        redactionMethod: "placeholder"
      }),
      new WhatsAppStyleProcessor()
    ]
  });
};

"use strict";
await storage.init();
const realEstateAgent = await getRealEstateAgent("");
const dynamicInstructions = "Eres un experto administrador de bienes ra\xEDces que puede agendar citas con clientes para ver propiedades. Cuando el cliente solicita una visita ejecuta la herramienta get_available_slots, luego cuando el cliente confirma la fecha y hora de la visita ejecuta la herramienta create_calendar_event";
const alquiler = await getRealEstateAgent("test-user", dynamicInstructions, "ALQUILAR");
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
    alquiler
  }
});

export { mastra };
