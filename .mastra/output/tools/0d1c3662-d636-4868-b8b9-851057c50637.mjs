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
  const currentYear = now.getFullYear();
  let startDate = new Date(startIso);
  let endDate = new Date(endIso);
  if (startDate.getFullYear() < currentYear) {
    startDate.setFullYear(currentYear);
    endDate.setFullYear(currentYear);
  }
  return {
    finalStart: startDate.toISOString(),
    finalEnd: endDate.toISOString()
  };
};
const calendarManagerTools = {
  /**
   * Herramienta para crear eventos con validación de año automática
   */
  createCalendarEvent: createTool({
    id: "create_calendar_event",
    description: `Crea un nuevo evento o visita en Google Calendar. HOY ES: ${(/* @__PURE__ */ new Date()).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}. Corrige autom\xE1ticamente el a\xF1o si el agente intenta agendar en el pasado.`,
    inputSchema: z.object({
      summary: z.string().describe("T\xEDtulo del evento (ej: Visita Propiedad X)"),
      location: z.string().describe("Direcci\xF3n completa de la propiedad"),
      start: z.string().describe("Fecha y hora de inicio en formato ISO"),
      end: z.string().describe("Fecha y hora de fin en formato ISO")
    }),
    execute: async ({ summary, location, start, end }) => {
      const calendar = getGoogleCalendar();
      const { finalStart, finalEnd } = getSanitizedDates(start, end);
      try {
        const response = await calendar.events.insert({
          calendarId: "primary",
          requestBody: {
            summary,
            location,
            start: {
              dateTime: finalStart,
              timeZone: "America/Argentina/Buenos_Aires"
            },
            end: {
              dateTime: finalEnd,
              timeZone: "America/Argentina/Buenos_Aires"
            }
          }
        });
        return {
          success: true,
          eventId: response.data.id,
          link: response.data.htmlLink,
          scheduledStart: finalStart,
          message: start !== finalStart ? "Fecha corregida al a\xF1o actual autom\xE1ticamente." : "Agendado correctamente."
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
  })
};

export { calendarManagerTools };
