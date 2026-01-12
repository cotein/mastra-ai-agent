import 'dotenv/config';
import { Mastra } from '@mastra/core';
import { registerApiRoute } from '@mastra/core/server';
import { stream } from 'hono/streaming';
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { openai as openai$1 } from '@ai-sdk/openai';
import { PostgresStore, PgVector } from '@mastra/pg';
import { Pool } from 'pg';
import { SystemPromptScrubber, PromptInjectionDetector, ModerationProcessor, TokenLimiter } from '@mastra/core/processors';
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
const calendarManagerTools = {
  /**
   * Herramienta para crear eventos con validación de año automática
   */
  createCalendarEvent: createTool({
    id: "create_calendar_event",
    description: "Registra citas de visitas inmobiliarias.",
    inputSchema: z.object({
      title: z.string().optional().describe('T\xEDtulo descriptivo del evento (ej: "Visita propiedad - cliente: ...")'),
      summary: z.string().optional().describe('Resumen corto (ej: "Visita propiedad - [Direccion]")'),
      location: z.string().describe("Direcci\xF3n completa de la propiedad"),
      description: z.string().describe("Detalles de contacto y cliente y propiedad"),
      start: z.string().describe(`Fecha inicio ISO8601. REGLA: Si hoy es ${(/* @__PURE__ */ new Date()).toLocaleDateString()} y agend\xE1s para un mes anterior, us\xE1 el a\xF1o ${(/* @__PURE__ */ new Date()).getFullYear()}.`),
      end: z.string().describe("Fecha fin ISO8601")
    }),
    execute: async (input) => {
      const calendar = getGoogleCalendar();
      const { start, end } = getSanitizedDates(input.start, input.end);
      const eventSummary = input.title || input.summary || "Visita Propiedad";
      try {
        const response = await calendar.events.insert({
          calendarId: "primary",
          requestBody: {
            summary: eventSummary,
            location: input.location,
            description: input.description,
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
          scheduledStart: start,
          message: input.start !== start ? "Fecha corregida al a\xF1o actual autom\xE1ticamente." : "Agendado correctamente."
        };
      } catch (error) {
        console.error("Error creando evento en Google Calendar:", error);
        return { success: false, error: error.message };
      }
    }
  }),
  /**
   * Herramienta para listar eventos con ancla en el tiempo real
   */
  listCalendarEvents: createTool({
    id: "list_calendar_events",
    description: "Lista los pr\xF3ximos eventos del calendario para verificar disponibilidad.",
    inputSchema: z.object({
      daysAhead: z.number().default(15).describe("N\xFAmero de d\xEDas a futuro para consultar")
    }),
    execute: async ({ daysAhead }) => {
      const calendar = getGoogleCalendar();
      const timeMin = (/* @__PURE__ */ new Date()).toISOString();
      const timeMax = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1e3).toISOString();
      try {
        const response = await calendar.events.list({
          calendarId: "primary",
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
  }),
  /**
   * Herramienta para obtener un evento por ID
   */
  getCalendarEvent: createTool({
    id: "get_calendar_event",
    description: "Obtiene los detalles de un evento espec\xEDfico de Google Calendar usando su ID.",
    inputSchema: z.object({
      eventId: z.string().describe("ID del evento a obtener")
    }),
    execute: async ({ eventId }) => {
      const calendar = getGoogleCalendar();
      try {
        const response = await calendar.events.get({
          calendarId: "primary",
          eventId
        });
        return response.data;
      } catch (error) {
        console.error("Error obteniendo evento:", error);
        return { success: false, error: error.message };
      }
    }
  }),
  /**
   * Herramienta para actualizar un evento existente
   */
  updateCalendarEvent: createTool({
    id: "update_calendar_event",
    description: "Actualiza un evento existente en Google Calendar. Puede cambiar horario, t\xEDtulo, descripci\xF3n o ubicaci\xF3n.",
    inputSchema: z.object({
      eventId: z.string().describe("ID del evento a modificar"),
      summary: z.string().optional().describe("Nuevo t\xEDtulo del evento"),
      description: z.string().optional().describe("Nueva descripci\xF3n"),
      location: z.string().optional().describe("Nueva ubicaci\xF3n"),
      start: z.string().optional().describe("Nueva fecha de inicio (ISO)"),
      end: z.string().optional().describe("Nueva fecha de fin (ISO)"),
      userEmail: z.string().optional().describe("Email del usuario para enviar notificaciones de actualizaci\xF3n (opcional)")
    }),
    execute: async ({ eventId, summary, description, location, start, end, userEmail }) => {
      const calendar = getGoogleCalendar();
      let currentEvent;
      try {
        const getRes = await calendar.events.get({ calendarId: "primary", eventId });
        currentEvent = getRes.data;
      } catch (e) {
        return { success: false, error: "Evento no encontrado: " + e.message };
      }
      let startBody = currentEvent.start;
      let endBody = currentEvent.end;
      if (start && end) {
        const { start: sanitizedStart, end: sanitizedEnd } = getSanitizedDates(start, end);
        startBody = { dateTime: sanitizedStart, timeZone: "America/Argentina/Buenos_Aires" };
        endBody = { dateTime: sanitizedEnd, timeZone: "America/Argentina/Buenos_Aires" };
      }
      const requestBody = {
        ...currentEvent,
        summary: summary || currentEvent.summary,
        description: description || currentEvent.description,
        location: location || currentEvent.location,
        start: startBody,
        end: endBody
      };
      try {
        const response = await calendar.events.update({
          calendarId: "primary",
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
  }),
  /**
   * Herramienta para eliminar un evento
   */
  deleteCalendarEvent: createTool({
    id: "delete_calendar_event",
    description: "Elimina (cancela) un evento de Google Calendar permanentemente.",
    inputSchema: z.object({
      eventId: z.string().describe("ID del evento a eliminar"),
      notifyStart: z.boolean().optional().describe("No utilizado, pero mantenido por compatibilidad")
    }),
    execute: async ({ eventId }) => {
      const calendar = getGoogleCalendar();
      try {
        await calendar.events.delete({
          calendarId: "primary",
          eventId
        });
        return { success: true, message: "Evento eliminado correctamente." };
      } catch (error) {
        console.error("Error eliminando evento:", error);
        return { success: false, error: error.message };
      }
    }
  }),
  /**
   * Herramienta para obtener horarios disponibles
   */
  getAvailableSlots: createTool({
    id: "get_available_slots",
    description: "Obtiene slots de horarios disponibles de 10:00 a 16:00 para los pr\xF3ximos 5 d\xEDas, excluyendo fines de semana.",
    inputSchema: z.object({}),
    execute: async () => {
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
            calendarId: "primary",
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
          console.error(`Error fetching events for ${currentDate.toISOString()}:`, error);
        }
      }
      return availableSlots.slice(0, 5);
    }
  }),
  /**
   * Herramienta para buscar eventos usando lenguaje natural
   * Ej: "Lunes 12 de enero a las 12", "el lunes a mediodía"
   */
  findEventByNaturalDate: createTool({
    id: "find_event_by_natural_date",
    description: 'Busca eventos en el calendario usando una fecha/hora en lenguaje natural (ej. "lunes 12 a las 12", "ma\xF1ana al mediod\xEDa"). Retorna los eventos encontrados en esa fecha/hora exacta o aproximada.',
    inputSchema: z.object({
      query: z.string().describe('La fecha y hora en lenguaje natural. Ej: "Lunes 12 de enero a las 12", "12/01 a las 12:00"')
    }),
    execute: async ({ query }) => {
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
          calendarId: "primary",
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
  })
};

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
const gmailManagerTools = {
  // ENVIAR EMAIL
  sendEmail: createTool({
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
  }),
  // LEER Y CLASIFICAR ÚLTIMOS EMAILS
  listEmails: createTool({
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
  })
};

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
  description: "NOTIFICACI\xD3N OBLIGATORIA: Env\xEDa un email a los due\xF1os cuando un cliente quiere visitar una propiedad de VENTA.",
  inputSchema: z.object({
    nombre_cliente: z.string(),
    telefono_cliente: z.string(),
    email_cliente: z.string().optional(),
    direccion_propiedad: z.string(),
    url_propiedad: z.string().optional()
  }),
  execute: async (input) => {
    const gmail = getGmail();
    const recipients = ["c.vogzan@gmail.com", "faustiprop@gmail.com", "diego.barrueta@gmail.com"];
    const telLimpio = input.telefono_cliente.replace(/[^0-9]/g, "");
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
            <div class="field-label">Propiedad</div> <div class="field-value">${input.direccion_propiedad}</div> 
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
  ...calendarManagerTools,
  ...gmailManagerTools
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
          `
      },
      generateTitle: true
    }
  });
  const finalInstructions = instructionsInjected || DEFAULT_SYSTEM_PROMPT;
  let selectedTools = { ...commonTools };
  if (operacionTipo === "ALQUILAR") {
    selectedTools = { ...selectedTools };
  } else if (operacionTipo === "VENDER") {
    selectedTools = { ...selectedTools, ...salesTools };
  } else {
    selectedTools = { ...selectedTools };
  }
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
      })
    ]
  });
};

"use strict";
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});
const realEstatePropertyFormatterTool = createTool({
  id: "real-estate-property-formatter",
  description: "Limpia, extrae y formatea informaci\xF3n t\xE9cnica de descripciones inmobiliarias.",
  inputSchema: z.object({
    keywordsZonaProp: z.string().describe("El texto bruto de la descripci\xF3n de la propiedad")
  }),
  outputSchema: z.object({
    formattedText: z.string().describe("El listado formateado y coherente")
  }),
  execute: async ({ keywordsZonaProp }) => {
    console.log("   [Tool] \u{1F6E0}\uFE0F  Conectando directo con API OpenAI (gpt-4o-mini)...");
    const systemPrompt = `Eres un motor de extracci\xF3n de datos t\xE9cnicos inmobiliarios. 
    Tu \xFAnica tarea es extraer y limpiar los datos.
    
    Campos a extraer:
    - Tipo
    - Operaci\xF3n
    - Ubicaci\xF3n (Barrio, Localidad)
    - Superficie (solo n\xFAmeros y unidad)
    - Ambientes (cantidad)

    Reglas de Salida ESTRICTAS:
    1. Devuelve SOLO la lista de datos. NADA de texto introductorio ("Aqu\xED tienes", "Revisando").
    2. NO uses Markdown (ni negritas **, ni bloques, ni guiones -).
    3. NO repitas informaci\xF3n.
    4. Formato: "Campo: Valor".`;
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
    
  `,
  model: "openai/gpt-4.1-mini"
});

"use strict";
const frasesRevisareLink = [
  "Dame un toque que lo veo y te digo... \u{1F50D}",
  "Ahora lo miro y te aviso... \u{1F440}",
  "D\xE9jame revisarlo y te confirmo... \u{1F4F2}",
  "Esper\xE1 que lo chequeo y te comento... \u{1F914}",
  "Ahora le doy una mirada y te respondo... \u{1F517}",
  "Voy a verlo y te digo... \u{1F4AC}",
  "Lo reviso y te aviso... \u{1F4F1}",
  "Dame un momento, lo veo y te aviso... \u23F3",
  "Ahora lo abro y te doy mi opini\xF3n... \u2728",
  "De una, lo miro y te contacto... \u{1F4AF}",
  "Ya mismo lo veo y te cuento... \u{1F4DD}",
  "D\xE9jame que lo analizo y te contesto... \u{1F9D0}",
  "Ahora me fijo y te escribo... \u270D\uFE0F",
  "Voy a echarle un ojo y te digo... \u{1F441}\uFE0F",
  "Lo chequeo r\xE1pido y te mando mensaje... \u26A1",
  "Ahora lo examino y te paso feedback... \u{1F50E}",
  "Dejame verlo y te respondo enseguida... \u{1F680}",
  "Ya lo abro, lo miro y te contacto... \u{1F4E8}",
  "En un segundo lo reviso y te aviso... \u{1F552}",
  "Ahora mismo lo veo y te tiro un mensaje... \u{1F4AD}"
];
const frasesDisponibilidad = [
  "\xBFQu\xE9 d\xEDa y rango horario te queda c\xF3modo?",
  "\xBFEn qu\xE9 d\xEDa y franja horaria tienes disponibilidad?",
  "\xBFQu\xE9 fecha y horario se ajustan mejor a tu agenda?",
  "\xBFQu\xE9 d\xEDa y rango de horas te viene bien?",
  "\xBFCu\xE1l es el d\xEDa y el horario que m\xE1s te conviene?",
  "\xBFEn qu\xE9 d\xEDa y qu\xE9 horas tienes libre?",
  "\xBFQu\xE9 fecha y turno prefieres para coordinar?",
  "\xBFQu\xE9 d\xEDa y per\xEDodo del d\xEDa te funciona mejor?",
  "\xBFEn qu\xE9 jornada y momento del d\xEDa est\xE1s disponible?",
  "\xBFQu\xE9 fecha y franja horaria se acomoda a tu tiempo?"
];
const frasesSolicitudDatos = [
  "Para avanzar, necesitar\xEDa por favor tu nombre, apellido, email y tel\xE9fono.",
  "Para continuar, requiero que proporciones tu nombre, apellido, correo electr\xF3nico y n\xFAmero de contacto.",
  "Necesito tu nombre completo, direcci\xF3n de email y tel\xE9fono para proceder.",
  "Para completar el proceso, por favor ingresa tu nombre, apellido, email y n\xFAmero telef\xF3nico.",
  "Ser\xEDa necesario que me brindes tu nombre, apellido, correo y tel\xE9fono de contacto.",
  "Para seguir adelante, te solicito tu nombre, apellidos, email y tel\xE9fono.",
  "Requiero tu nombre y apellido, junto con tu email y n\xFAmero de tel\xE9fono.",
  "Para poder ayudarte, necesito que me des tu nombre completo, email y tel\xE9fono.",
  "Es necesario que proporciones tu nombre, apellido, direcci\xF3n de correo y tel\xE9fono.",
  "Para finalizar, preciso que completes con tu nombre, apellido, email y n\xFAmero de contacto."
];

"use strict";
function auditMissingFields(datos) {
  const missing = [];
  const isInvalid = (val) => !val || val === "" || val === "Preguntar" || val === "Ver chat";
  if (isInvalid(datos.nombre)) missing.push("NOMBRE");
  if (isInvalid(datos.apellido)) missing.push("APELLIDO");
  if (isInvalid(datos.email)) missing.push("EMAIL");
  if (isInvalid(datos.telefono)) missing.push("TEL\xC9FONO");
  return missing;
}
function obtenerFraseAleatoriaRevisarLink() {
  const indiceAleatorio = Math.floor(Math.random() * frasesRevisareLink.length);
  return frasesRevisareLink[indiceAleatorio];
}
function obtenerFraseAleatoriaDisponibilidad() {
  const indiceAleatorio = Math.floor(Math.random() * frasesDisponibilidad.length);
  return frasesDisponibilidad[indiceAleatorio];
}
function obtenerFraseAleatoriaSolicitudDatos() {
  const indiceAleatorio = Math.floor(Math.random() * frasesSolicitudDatos.length);
  return frasesSolicitudDatos[indiceAleatorio];
}
const CORE_IDENTITY = `
# I. IDENTIDAD & ROL
Eres NICO, asistente de IA de Fausti Propiedades.

### \u{1F4F1} ESTILO DE COMUNICACI\xD3N (WHATSAPP MODE)
Act\xFAa como una persona real escribiendo r\xE1pido por WhatsApp:
- **FORMATO**: Usa min\xFAsculas casi siempre. Evita puntos finales en oraciones cortas.
- **TONO**: Casual, emp\xE1tico, directo ("vos", "dale", "genial").
- **EMOJIS**: Pocos, solo si suma onda (1 o 2 max).
- **PROHIBIDO**: No seas rob\xF3tico. No uses "Estimado", "Quedo a la espera", "Cordialmente".
- **CLIVAJES**: Si tienes que decir varias cosas, usa oraciones breves y directas.

### Reglas Operativas
- **Regla Suprema**: Tu comportamiento depende 100% del "TIPO DE OPERACI\xD3N".
- **Privacidad**:
  1. TERCEROS: JAM\xC1S reveles datos de otros.
  2. USUARIO: Si pregunta "\xBFQu\xE9 sabes de m\xED?", responde SOLO con lo que ves en "DATOS ACTUALES".
`;
function getTemporalContext() {
  return (/* @__PURE__ */ new Date()).toLocaleDateString("es-AR", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}
const dynamicInstructions = (datos, op) => {
  const opNormalizada = op ? op.toUpperCase() : "INDEFINIDO";
  const missingFields = auditMissingFields(datos);
  let statusBlock = "";
  if (missingFields.length > 0) {
    const missingString = missingFields.map((f) => f.toLowerCase()).join(", ").replace(/, ([^,]*)$/, " y $1");
    statusBlock = `
## \u{1F6A8} ESTADO: DATOS INCOMPLETOS
Faltan: ${missingFields.join(", ")}.

### \u26A1 TU OBJETIVO:
Pide **TODOS** los datos faltantes en **UNA SOLA ORACI\xD3N** al final de tu respuesta.
Formato: ${obtenerFraseAleatoriaSolicitudDatos()} **${missingString}**."
(NO inventes datos. NO preguntes uno a uno).
    `;
  } else {
    statusBlock = `
## \u2705 ESTADO: FICHA COMPLETA
Procede con el protocolo operativo.
    `;
  }
  let protocolBlock = "";
  if (opNormalizada === "ALQUILAR") {
    protocolBlock = `
# III. FLUJO: ALQUILER (OBJETIVO: CITA)
1. **Validaci\xF3n**: Celebra la elecci\xF3n ("\xA1Excelente opci\xF3n!").
2. **Acci\xF3n**: Pregunta DIRECTO: **${obtenerFraseAleatoriaDisponibilidad()}**
   - Usa 'get_available_slots'.
   - NO asumas horarios.
3. **Cierre**: Una vez acordado, agenda con 'create_calendar_event'.
4. **PROHIBICI\xD3N**: BAJO NINGUNA CIRCUNSTANCIA utilices la herramienta \`potential_sale_email\`.
      `;
  } else if (opNormalizada === "VENDER") {
    protocolBlock = `
# III. FLUJO: VENTA (OBJETIVO: DERIVAR)
1. **Acci\xF3n**: usa 'potential_sale_email'.
2. **Despedida**: "Genial, en el d\xEDa te contactamos por la compra. \xA1Gracias! \u{1F60A}"
3. **Fin**: Cierra la conversaci\xF3n.
      `;
  }
  return `
  ${CORE_IDENTITY}

  # II. DATOS ACTUALES
  - Nombre: ${datos.nombre || "No registrado"}
  - Apellido: ${datos.apellido || "No registrado"}
  - Email: ${datos.email || "No registrado"}
  - Tel\xE9fono: ${datos.telefono || "No registrado"}
  
  ${statusBlock}

  ${protocolBlock}

  - Fecha: ${getTemporalContext()}
  `;
};

"use strict";
const sleep = async (seconds) => {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1e3));
};

"use strict";
const randomSleep = async (min, max) => {
  const waitTime = Math.random() * (max - min) + min;
  await sleep(waitTime);
};

"use strict";
const propertyDataProcessorTool = createTool({
  id: "property-data-processor",
  description: "Procesa los datos crudos de una propiedad (JSON) y extrae keywords, localidad y direcci\xF3n.",
  inputSchema: z.object({
    rawData: z.array(z.any())
    // Recibe el array de objetos que retorna el scraper
  }),
  outputSchema: z.object({
    keywords: z.string().optional(),
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
    let addressLocality;
    let streetAddress;
    let operacionTipo;
    if (metadata.jsonLd && Array.isArray(metadata.jsonLd)) {
      const itemWithAddress = metadata.jsonLd.find((item) => item?.address);
      if (itemWithAddress && itemWithAddress.address) {
        addressLocality = itemWithAddress.address.addressLocality;
        streetAddress = itemWithAddress.address.streetAddress;
      }
    }
    if (keywords) {
      const upperKeywords = keywords.toUpperCase();
      if (upperKeywords.includes("ALQUILAR") || upperKeywords.includes("ALQUILER") || upperKeywords.includes("ALQUILA")) {
        operacionTipo = "ALQUILAR";
      } else if (upperKeywords.includes("VENDER") || upperKeywords.includes("VENTA") || upperKeywords.includes("COMPRA")) {
        operacionTipo = "VENDER";
      } else {
        operacionTipo = "";
      }
    } else {
      operacionTipo = "";
    }
    return {
      keywords,
      addressLocality,
      streetAddress,
      operacionTipo
    };
  }
});

"use strict";
const scrapeStep = createStep({
  id: "scrapeStep",
  inputSchema: z.object({
    url: z.url()
  }),
  outputSchema: z.object({
    success: z.boolean(),
    data: z.any()
  }),
  execute: async ({ inputData }) => {
    console.log(">>> INICIO: PASO 1 (Scraping)");
    console.log(`[Workflow] \u{1F310} Scrapeando URL: ${inputData.url}`);
    await sleep(3);
    const result = await apifyScraperTool.execute(
      { url: inputData.url }
    );
    console.log(">>> FIN: PASO 1");
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
    keywords: z.string()
  }),
  maxRetries: 2,
  retryDelay: 2500,
  execute: async ({ inputData, mastra }) => {
    try {
      const result = await propertyDataProcessorTool.execute(
        { rawData: inputData.data },
        { mastra }
      );
      console.log(">>> DEBUG: propertyDataProcessorTool result:", JSON.stringify(result, null, 2));
      if (!("operacionTipo" in result)) {
        throw new Error("Validation failed in propertyDataProcessorTool");
      }
      console.log(">>> INICIO: PASO 2 (Formato)");
      console.log(result);
      console.log(">>> FIN: PASO 2");
      return {
        address: [result.addressLocality, result.streetAddress].filter(Boolean).join(", "),
        operacionTipo: result.operacionTipo,
        // Guaranteed by the check above
        keywords: result.keywords || ""
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
    address: z.string()
  }),
  outputSchema: z.object({
    formattedText: z.string(),
    operacionTipo: z.enum(["ALQUILAR", "VENDER", ""]),
    address: z.string()
  }),
  execute: async ({ inputData }) => {
    console.log(">>> INICIO: PASO 3 (Limpieza/Formatter)");
    const result = await realEstatePropertyFormatterTool.execute({
      keywordsZonaProp: inputData.keywords
    });
    console.log(">>> DEBUG: Formatter result:", result);
    console.log(">>> FIN: PASO 3");
    return {
      formattedText: result.formattedText || inputData.keywords,
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
    console.log(">>> INICIO: PASO 4 (Logic)");
    console.log(">>> FIN: PASO 4");
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
const mastra = new Mastra({
  storage,
  vectors: {
    vectorStore
  },
  agents: {
    realEstateAgent,
    realEstateCleaningAgent
  },
  tools: {
    realEstatePropertyFormatterTool
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
          console.log("\u{1F4E8} RAW BODY RECIBIDO:", JSON.stringify(body, null, 2));
          const {
            message,
            threadId,
            userId,
            clientData
          } = body;
          console.log("\n\u{1F525}\u{1F525}\u{1F525} INICIO DEL REQUEST \u{1F525}\u{1F525}\u{1F525}");
          console.log("1. ThreadID recibido:", threadId);
          console.log("2. ClientData CRUDA:", clientData);
          console.log("3. \xBFTiene llaves?", clientData ? Object.keys(clientData) : "Es Null/Undefined");
          if (!threadId) {
            return c.json({
              error: "ThreadID is required"
            }, 400);
          }
          const currentThreadId = threadId || `chat_${userId}`;
          const urlRegex = /(https?:\/\/[^\s]+)/g;
          const linksEncontrados = message?.match(urlRegex);
          let finalContextData = {};
          finalContextData.operacionTipo = "";
          let propertyOperationType = "";
          try {
            if (clientData && Object.keys(clientData).length > 0) {
              const validResourceId = userId || "anonymous_user";
              await ThreadContextService.updateContext(threadId, validResourceId, clientData);
            }
            const dbContext = await ThreadContextService.getContext(threadId);
            const mastraProfile = await ThreadContextService.getResourceProfile(userId);
            console.log("\u{1F9E0} [PERFIL MASTRA DETECTADO]:", mastraProfile);
            console.log("\u{1F50D} [DB] Datos guardados en Base de Datos:", dbContext);
            finalContextData = {
              ...mastraProfile,
              // 1. Base (Mastra)
              ...dbContext,
              // 2. Contexto Thread
              ...clientData || {}
              // 3. Override actual
            };
            console.log("\u{1F9E0} [MEMORIA FINAL] Esto es lo que sabr\xE1 el agente:", finalContextData);
          } catch (err) {
            console.error("\u26A0\uFE0F Error gestionando contexto en DB (usando fallback):", err);
            finalContextData = clientData || {};
          }
          return stream(c, async (streamInstance) => {
            if (linksEncontrados && linksEncontrados.length > 0) {
              const url = linksEncontrados[0].trim();
              finalContextData.link = url;
              if (currentThreadId) {
                await ThreadContextService.clearThreadMessages(currentThreadId);
              }
              await randomSleep(1, 3);
              await streamInstance.write(frasesRevisareLink[Math.floor(Math.random() * frasesRevisareLink.length)] + "\n\n");
              try {
                const workflow = mastra.getWorkflow("propertyWorkflow");
                const run = await workflow.createRun();
                console.log(`\u{1F680} Iniciando Workflow para: ${url}`);
                const result = await run.start({
                  inputData: {
                    url
                  }
                });
                if (result.status !== "success") {
                  throw new Error(`Workflow failed: ${result.status}`);
                }
                const outputLogica = result.result;
                if (outputLogica) {
                  console.log("\u{1F4E6} Output Workflow recibido");
                  if (outputLogica.minimalDescription) {
                    await streamInstance.write(outputLogica.minimalDescription + "\n\n");
                    await randomSleep(2, 4);
                    await streamInstance.write(outputLogica.address + "\n\n");
                  }
                  if (outputLogica.operacionTipo) {
                    propertyOperationType = outputLogica.operacionTipo;
                    console.log("\u{1F680} Tipo de operaci\xF3n detectado ########## :", propertyOperationType);
                    finalContextData.operacionTipo = outputLogica.operacionTipo;
                    finalContextData.propertyAddress = outputLogica.address;
                  }
                }
              } catch (workflowErr) {
                console.error("\u274C Workflow error:", workflowErr);
              }
            }
            try {
              console.log("\u{1F4DD} [PROMPT] Generando instrucciones con:", finalContextData);
              const contextoAdicional = dynamicInstructions(finalContextData, propertyOperationType.toUpperCase());
              console.log("\u{1F4DD} [PROMPT] Contexto adicional:", contextoAdicional);
              const agent = await getRealEstateAgent(userId, contextoAdicional, finalContextData.operacionTipo);
              console.log("\u{1F6E0}\uFE0F Tools disponibles para el agente:", Object.keys(agent.tools || {}));
              console.log("whatsapp-style: Volviendo a stream() por latencia. El estilo se manejar\xE1 via Prompt.");
              const result = await agent.stream(message, {
                threadId: currentThreadId,
                resourceId: userId
              });
              if (result.textStream) {
                for await (const chunk of result.textStream) {
                  await streamInstance.write(chunk);
                }
              }
            } catch (streamError) {
              console.error("\u{1F4A5} Error en el stream del agente:", streamError);
              await streamInstance.write("\n\n[Lo siento, tuve un problema procesando tu respuesta final.]");
            }
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

export { mastra };
