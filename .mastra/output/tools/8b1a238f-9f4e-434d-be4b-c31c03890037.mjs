import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { google } from 'googleapis';

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
      calendarId: z.string().optional().describe('ID del calendario donde agendar. Si no se provee, usa el calendario principal ("primary").'),
      title: z.string().optional().describe('T\xEDtulo descriptivo del evento (ej: "Visita propiedad - cliente: ...")'),
      summary: z.string().optional().describe('Resumen corto (ej: "Visita propiedad - [Direccion]")'),
      location: z.string().describe("Direcci\xF3n completa de la propiedad"),
      description: z.string().describe("Detalles de contacto y cliente y propiedad"),
      start: z.string().describe(`Fecha inicio ISO8601. REGLA: Si hoy es ${(/* @__PURE__ */ new Date()).toLocaleDateString()} y agend\xE1s para un mes anterior, us\xE1 el a\xF1o ${(/* @__PURE__ */ new Date()).getFullYear()}.`),
      end: z.string().describe("Fecha fin ISO8601")
    }),
    execute: async (input) => {
      const calendar = getGoogleCalendar();
      const calendarId = input.calendarId || "primary";
      const { start, end } = getSanitizedDates(input.start, input.end);
      const eventSummary = input.title || input.summary || "Visita Propiedad";
      try {
        const response = await calendar.events.insert({
          calendarId,
          requestBody: {
            summary: eventSummary,
            location: input.location,
            description: input.description,
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
      calendarId: z.string().optional().describe('ID del calendario a consultar. (Default: "primary")'),
      daysAhead: z.number().default(15).describe("N\xFAmero de d\xEDas a futuro para consultar")
    }),
    execute: async ({ daysAhead, calendarId: inputCalendarId }) => {
      const calendar = getGoogleCalendar();
      const calendarId = inputCalendarId || "primary";
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
  }),
  /**
   * Herramienta para obtener un evento por ID
   */
  getCalendarEvent: createTool({
    id: "get_calendar_event",
    description: "Obtiene los detalles de un evento espec\xEDfico de Google Calendar usando su ID.",
    inputSchema: z.object({
      eventId: z.string().describe("ID del evento a obtener"),
      calendarId: z.string().optional().describe('ID del calendario (Default: "primary")')
    }),
    execute: async ({ eventId, calendarId: inputCalendarId }) => {
      const calendar = getGoogleCalendar();
      const calendarId = inputCalendarId || "primary";
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
  }),
  /**
   * Herramienta para actualizar un evento existente
   */
  updateCalendarEvent: createTool({
    id: "update_calendar_event",
    description: "Actualiza un evento existente en Google Calendar. Puede cambiar horario, t\xEDtulo, descripci\xF3n o ubicaci\xF3n.",
    inputSchema: z.object({
      eventId: z.string().describe("ID del evento a modificar"),
      calendarId: z.string().optional().describe('ID del calendario (Default: "primary")'),
      summary: z.string().optional().describe("Nuevo t\xEDtulo del evento"),
      description: z.string().optional().describe("Nueva descripci\xF3n"),
      location: z.string().optional().describe("Nueva ubicaci\xF3n"),
      start: z.string().optional().describe("Nueva fecha de inicio (ISO)"),
      end: z.string().optional().describe("Nueva fecha de fin (ISO)"),
      userEmail: z.string().optional().describe("Email del usuario para enviar notificaciones de actualizaci\xF3n (opcional)")
    }),
    execute: async ({ eventId, summary, description, location, start, end, userEmail, calendarId: inputCalendarId }) => {
      const calendar = getGoogleCalendar();
      const calendarId = inputCalendarId || "primary";
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
  }),
  /**
   * Herramienta para eliminar un evento
   */
  deleteCalendarEvent: createTool({
    id: "delete_calendar_event",
    description: "Elimina (cancela) un evento de Google Calendar permanentemente.",
    inputSchema: z.object({
      eventId: z.string().describe("ID del evento a eliminar"),
      calendarId: z.string().optional().describe('ID del calendario (Default: "primary")'),
      notifyStart: z.boolean().optional().describe("No utilizado, pero mantenido por compatibilidad")
    }),
    execute: async ({ eventId, calendarId: inputCalendarId }) => {
      const calendar = getGoogleCalendar();
      const calendarId = inputCalendarId || "primary";
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

export { calendarManagerTools };
