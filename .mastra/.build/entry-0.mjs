import 'dotenv/config';
import { Mastra } from '@mastra/core';
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { openai as openai$1 } from '@ai-sdk/openai';
import { PostgresStore, PgVector } from '@mastra/pg';
import { Pool } from 'pg';
import { SystemPromptScrubber, PromptInjectionDetector, ModerationProcessor, TokenLimiter } from '@mastra/core/processors';
import { generateText } from 'ai';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { google } from 'googleapis';
import axios from 'axios';
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
  const now = /* @__PURE__ */ new Date();
  let startDate = new Date(startIso);
  let endDate = new Date(endIso);
  if (startDate < now) {
    console.log("Detectada fecha pasada, corrigiendo a\xF1o...");
    startDate.setFullYear(startDate.getFullYear() + 1);
    endDate.setFullYear(endDate.getFullYear() + 1);
  }
  return {
    start: startDate.toISOString(),
    end: endDate.toISOString()
  };
};
const createCalendarEvent = createTool({
  id: "create_calendar_event",
  description: "Registra citas de visitas inmobiliarias en el calendario oficial de Fausti. Esta herramienta DEBE ser usada cuando el cliente confirma un horario. Requiere datos del cliente y propiedad.",
  inputSchema: z.object({
    title: z.string().optional().describe("T\xEDtulo descriptivo del evento"),
    start: z.string().describe(`Fecha inicio ISO8601. REGLA: Si hoy es ${(/* @__PURE__ */ new Date()).toLocaleDateString()} y agend\xE1s para un mes anterior, us\xE1 el a\xF1o ${(/* @__PURE__ */ new Date()).getFullYear()}.`),
    end: z.string().optional().describe("Fecha fin ISO8601"),
    clientName: z.string().describe("Nombre y Apellido del cliente"),
    clientPhone: z.string().optional().describe("Tel\xE9fono del cliente"),
    clientEmail: z.string().optional().describe("Email del cliente"),
    propertyAddress: z.string().optional().describe("Direcci\xF3n de la propiedad"),
    propertyLink: z.string().optional().describe("Link de la propiedad")
  }),
  execute: async (input) => {
    console.log("\u{1F6E0}\uFE0F [TOOL START] create_calendar_event iniciado");
    console.log("\u{1F4CA} [PARAMS] Par\xE1metros recibidos del agente:", JSON.stringify(input, null, 2));
    const calendar = getGoogleCalendar();
    const calendarId = CALENDAR_ID;
    const { start, end } = getSanitizedDates(input.start, input.end);
    const eventSummary = input.title || `Visita Propiedad - ${input.clientName}`;
    const description = `visita propiedad - cliente: ${input.clientName} - tel: ${input.clientPhone || "Sin tel"} - email: ${input.clientEmail || "Sin email"} - Domicilio: ${input.propertyAddress} - Link: ${input.propertyLink || "Sin link"}`;
    try {
      const response = await calendar.events.insert({
        calendarId,
        requestBody: {
          summary: eventSummary,
          location: input.propertyAddress,
          description,
          // USAMOS EL FORMATO GENERADO
          start: {
            dateTime: start.replace(/Z$/, ""),
            timeZone: "America/Argentina/Buenos_Aires"
          },
          end: {
            dateTime: end.replace(/Z$/, ""),
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
      console.error("Error creando evento en Google Calendar:", error);
      return { success: false, error: error.message };
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
    start: z.string().optional().describe("Nueva fecha de inicio (ISO)"),
    end: z.string().optional().describe("Nueva fecha de fin (ISO)"),
    userEmail: z.string().optional().describe("Email del usuario para enviar notificaciones de actualizaci\xF3n (opcional)"),
    // Datos Estructurados para reconstrucción de formato
    clientName: z.string().optional().describe("Nombre y Apellido del cliente (para actualizar ficha)"),
    clientPhone: z.string().optional().describe("Tel\xE9fono del cliente"),
    clientEmail: z.string().optional().describe("Email del cliente"),
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
    let startBody = currentEvent.start;
    let endBody = currentEvent.end;
    if (start && end) {
      const { start: sanitizedStart, end: sanitizedEnd } = getSanitizedDates(start, end);
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
    try {
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
    const chrono = await import('chrono-node');
    const calendar = getGoogleCalendar();
    let normalizedQuery = query.toLowerCase().replace(/mediod[ií]a/g, "12:00").replace(/del d[ií]a/g, "").replace(/de la ma[ñn]ana/g, "am").replace(/de la tarde/g, "pm").replace(/de la noche/g, "pm");
    const results = chrono.es.parse(normalizedQuery, /* @__PURE__ */ new Date());
    if (results.length === 0) {
      return { success: false, message: "No pude entender la fecha y hora indicadas. Por favor, intenta ser m\xE1s espec\xEDfico (ej. 'Lunes 12 de enero a las 15:00')." };
    }
    const result = results[0];
    const date = result.start.date();
    const hasTime = result.start.isCertain("hour");
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
const commonTools = {
  createCalendarEvent,
  listCalendarEvents,
  getCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  findEventByNaturalDate,
  sendEmail,
  listEmails
};
const salesTools = {
  potential_sale_email: potentialSaleEmailTool
  // Solo para ventas
};
const getRealEstateAgent = async (userId, instructionsInjected, operacionTipo) => {
  const memory = new Memory({
    storage,
    vector: vectorStore,
    embedder: openai$1.embedding("text-embedding-3-small"),
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
  const selectedTools = operacionTipo === "ALQUILAR" ? { get_available_slots: getAvailableSlots, create_calendar_event: createCalendarEvent } : operacionTipo === "VENDER" ? { potential_sale_email: potentialSaleEmailTool } : {};
  console.log("#".repeat(50) + " REAL ESTATE AGENT " + "#".repeat(50));
  console.log(finalInstructions);
  console.log("#".repeat(50));
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
  description: "Limpia, extrae y formatea informaci\xF3n de descripciones inmobiliarias.",
  inputSchema: z.object({
    keywordsZonaProp: z.string().describe("El texto bruto de la descripci\xF3n de la propiedad")
  }),
  outputSchema: z.object({
    formattedText: z.string().describe("El listado formateado y coherente")
  }),
  execute: async ({ keywordsZonaProp }) => {
    console.log("   [Tool] \u{1F6E0}\uFE0F  Conectando directo con API OpenAI (gpt-4o-mini)...");
    const systemPrompt = `Eres un motor de extracci\xF3n de datos t\xE9cnicos inmobiliarios de Alta Precisi\xF3n.
    Analiza el texto desordenado y extrae la siguiente informaci\xF3n estructurada.
    
    ### CAMPOS A EXTRAER:
    1. **Tipo Operaci\xF3n**: (Alquiler, Venta o Temporal).
    2. **Ubicaci\xF3n**: Barrio y Localidad (Ej: "Palermo, CABA" o "El Cant\xF3n, Escobar"). Limpia nombres de inmobiliarias.
    3. **Superficie**: Prioriza Metros Totales y Cubiertos (Ej: "800m\xB2 Totales / 200m\xB2 Cubiertos").
    4. **Ambientes**: Cantidad de ambientes y dormitorios.
    5. **Requisitos**: Busca menciones sobre garant\xEDas (Ej: "Garant\xEDa Propietaria", "Seguro Cauci\xF3n", "Recibo de sueldo"). Si no hay info expl\xEDcita, pon "Consultar".
    6. **Mascotas**: Busca "Acepta mascotas", "No acepta mascotas" o \xEDconos. Si no dice nada, pon "A confirmar".
    7. **Precio**: Moneda y Valor (Ej: "USD 2.100").
    8. **Expensas**: Si figuran.

    ### REGLAS DE LIMPIEZA:
    - Ignora textos de publicidad como "Garant\xEDas 100% online", "Avisarme si baja", etc, salvo que sirvan para deducir requisitos.
    - Si hay datos contradictorios (ej: 4 amb y 6 amb), usa el m\xE1s espec\xEDfico o el que aparezca en la descripci\xF3n t\xE9cnica.

    ### FORMATO DE SALIDA (Texto Plano):
    Operaci\xF3n: [Valor]
    Ubicaci\xF3n: [Valor]
    Superficie: [Valor]
    Ambientes: [Valor]
    Precio: [Valor]
    Requisitos: [Valor]
    Mascotas: [Valor]
    `;
    const userPrompt = `Procesa este texto raw: "${keywordsZonaProp}"`;
    try {
      const completion = await openai.chat.completions.create({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        model: "gpt-4o-mini",
        temperature: 0.1
      });
      const text = completion.choices[0]?.message?.content || "No se pudo generar texto";
      console.log("   [Tool] \u2705 Respuesta recibida (Tokens usados: " + completion.usage?.total_tokens + ")");
      console.log("   [Tool] \u{1F4E6} DATA EXTRA\xCDDA:\n", text);
      return {
        formattedText: text
      };
    } catch (error) {
      console.error("   [Tool] \u274C Error Nativo OpenAI:", error.message);
      if (error.status === 429) {
        throw new Error("rate_limit_exceeded");
      }
      throw error;
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
    Eres obsesivo con la brevedad, la coherencia y la eliminaci\xF3n de duplicados.
    No a\xF1ades comentarios adicionales, solo devuelves el listado solicitado.  
    El tono debe ser profesional y persuasivo, destacando los beneficios.

    Interpretar:
    - Requisitos.
    - Informaci\xF3n de mascotas (solo si est\xE1 expl\xEDcita).

    Reglas:
    - Si no hay info de mascotas, no mencionarlas.
    - Si no hay requisitos: "Los requisitos son: garant\xEDa propietaria o seguro de cauci\xF3n, recibos que tripliquen el alquiler, mes de adelanto, dep\xF3sito y gastos de informes."
    - No decir "en el aviso no figura".
  `,
  model: "openai/gpt-4.1-mini"
});

"use strict";
const sleep = async (seconds) => {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1e3));
};

"use strict";
const propertyDataProcessorTool = createTool({
  id: "property-data-processor",
  description: "Procesa los datos crudos de una propiedad (JSON) y extrae caracteristicas, requisitos, localidad y direcci\xF3n.",
  inputSchema: z.object({
    rawData: z.array(z.any())
    // Recibe el array de objetos que retorna el scraper
  }),
  outputSchema: z.object({
    keywords: z.string().optional(),
    text: z.string().optional(),
    addressLocality: z.string().optional(),
    streetAddress: z.string().optional(),
    operacionTipo: z.enum(["ALQUILAR", "VENDER", ""])
  }),
  execute: async ({ rawData }) => {
    const dataItem = rawData[0];
    if (!dataItem) {
      return { operacionTipo: "" };
    }
    const metadata = dataItem.metadata || {};
    const keywords = metadata.keywords;
    const text = dataItem.text || dataItem.markdown || metadata.text || "";
    let addressLocality;
    let streetAddress;
    let operacionTipo = "";
    if (metadata.jsonLd && Array.isArray(metadata.jsonLd)) {
      const itemWithAddress = metadata.jsonLd.find((item) => item?.address);
      if (itemWithAddress && itemWithAddress.address) {
        addressLocality = itemWithAddress.address.addressLocality;
        streetAddress = itemWithAddress.address.streetAddress;
      }
    }
    const detectOperation = (content = "") => {
      const upper = content.toUpperCase();
      if (upper.includes("ALQUILAR") || upper.includes("ALQUILER") || upper.includes("ALQUILA")) return "ALQUILAR";
      if (upper.includes("VENDER") || upper.includes("VENTA") || upper.includes("VENDE")) return "VENDER";
      return "";
    };
    if (keywords) {
      operacionTipo = detectOperation(keywords);
    }
    if (!operacionTipo && metadata.title) {
      operacionTipo = detectOperation(metadata.title);
    }
    if (!operacionTipo && text) {
      operacionTipo = detectOperation(text.substring(0, 500));
    }
    return {
      keywords,
      addressLocality,
      streetAddress,
      operacionTipo,
      text
    };
  }
});

"use strict";
const scrapeStep = createStep({
  id: "scrapeStep",
  inputSchema: z.object({
    url: z.string().url()
  }),
  outputSchema: z.object({
    success: z.boolean(),
    data: z.any()
  }),
  execute: async ({ inputData }) => {
    await sleep(1);
    const result = await apifyScraperTool.execute(
      { url: inputData.url }
    );
    if (!("data" in result)) {
      throw new Error("Scraping failed");
    }
    return {
      success: true,
      data: result.data || []
    };
  }
});
const extratDataFromScrapperTool = createStep({
  id: "extratDataFromScrapperTool",
  inputSchema: z.object({
    data: z.any()
  }),
  outputSchema: z.object({
    address: z.string(),
    operacionTipo: z.enum(["ALQUILAR", "VENDER", ""]),
    keywords: z.string(),
    text: z.string()
  }),
  maxRetries: 2,
  retryDelay: 2500,
  execute: async ({ inputData, mastra }) => {
    try {
      const result = await propertyDataProcessorTool.execute(
        { rawData: inputData.data },
        { mastra }
      );
      if (!("operacionTipo" in result)) {
        throw new Error("Validation failed in propertyDataProcessorTool");
      }
      console.log(">>> INICIO: PASO 2 (Formato)");
      return {
        address: [result.addressLocality, result.streetAddress].filter(Boolean).join(", "),
        operacionTipo: result.operacionTipo,
        // Guaranteed by the check above
        keywords: result.keywords || "",
        text: result.text || ""
      };
    } catch (error) {
      if (error.message.includes("rate_limit_exceeded") || error.statusCode === 429) {
        console.warn("\u26A0\uFE0F Rate limit detectado. Reintentando paso...");
      }
      throw error;
    }
  }
});
const cleanDataStep = createStep({
  id: "cleanDataStep",
  inputSchema: z.object({
    keywords: z.string(),
    operacionTipo: z.enum(["ALQUILAR", "VENDER", ""]),
    address: z.string(),
    text: z.string()
  }),
  outputSchema: z.object({
    formattedText: z.string(),
    operacionTipo: z.enum(["ALQUILAR", "VENDER", ""]),
    address: z.string()
  }),
  execute: async ({ inputData }) => {
    const result = await realEstatePropertyFormatterTool.execute({
      keywordsZonaProp: inputData.text
    });
    return {
      formattedText: result.formattedText || inputData.text,
      // Fallback si falla
      operacionTipo: inputData.operacionTipo,
      address: inputData.address
    };
  }
});
const logicStep = createStep({
  id: "logicStep",
  inputSchema: z.object({
    address: z.string(),
    operacionTipo: z.enum(["ALQUILAR", "VENDER", ""]),
    formattedText: z.string()
  }),
  outputSchema: z.object({
    minimalDescription: z.string(),
    operacionTipo: z.enum(["ALQUILAR", "VENDER", ""]),
    address: z.string()
  }),
  execute: async ({ inputData }) => {
    return {
      minimalDescription: inputData.formattedText,
      operacionTipo: inputData.operacionTipo,
      address: inputData.address
    };
  }
});
const propertyWorkflow = createWorkflow({
  id: "property-intelligence-pipeline",
  inputSchema: z.object({
    url: z.string().url()
  }),
  outputSchema: z.object({
    minimalDescription: z.string(),
    operacionTipo: z.enum(["ALQUILAR", "VENDER", ""]),
    address: z.string()
  })
}).then(scrapeStep).then(extratDataFromScrapperTool).then(cleanDataStep).then(logicStep).commit();

"use strict";
await storage.init();
const realEstateAgent = await getRealEstateAgent("");
const rentalAgent = await getRealEstateAgent("test-user", "", "ALQUILAR");
const salesAgent = await getRealEstateAgent("test-user", "", "VENDER");
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
    rentalAgent,
    salesAgent
  },
  tools: {
    realEstatePropertyFormatterTool
  },
  workflows: {
    propertyWorkflow
  }
});

export { mastra };
