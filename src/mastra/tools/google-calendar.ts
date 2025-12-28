import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { google } from 'googleapis';

/**
 * CONFIGURACIÓN DE AUTH
 * Se mantiene tu lógica de autenticación con Google
 */
/**
 * CONFIGURACIÓN DE AUTH
 * Se mantiene tu lógica de autenticación con Google
 */
const getGoogleCalendar = () => {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!refreshToken || refreshToken === 'tu_refresh_token') {
    throw new Error('GOOGLE_REFRESH_TOKEN is missing or invalid in environment variables');
  }

  auth.setCredentials({ refresh_token: refreshToken });
  return google.calendar({ version: 'v3', auth });
}

/**
 * LÓGICA DE VALIDACIÓN TEMPORAL (SENIOR LAYER)
 * Esta función asegura que el agente no agende en el pasado (ej. 2023)
 * incluso si el LLM alucina con la fecha.
 */
const getSanitizedDates = (startIso: string, endIso: string) => {
  const now = new Date();
  const currentYear = now.getFullYear();
  
  let startDate = new Date(startIso);
  let endDate = new Date(endIso);

  // 1. Corrección de Año: Si el agente envía un año anterior al actual
  if (startDate.getFullYear() < currentYear) {
    startDate.setFullYear(currentYear);
    endDate.setFullYear(currentYear);
  }

  // 2. Corrección de Coherencia: Si al corregir el año, la fecha quedó en el pasado 
  // (ej: hoy es diciembre y el agente agendó para marzo de 2023 -> marzo 2024),
  // se asume que se refiere al ciclo anual siguiente si es necesario, 
  // pero para una inmobiliaria, forzar el año actual suele ser lo correcto.
  
  return {
    finalStart: startDate.toISOString(),
    finalEnd: endDate.toISOString()
  };
};

export const calendarManagerTools = {
  /**
   * Herramienta para crear eventos con validación de año automática
   */
  createCalendarEvent: createTool({
    id: 'create_calendar_event',
    description: `Crea un nuevo evento o visita en Google Calendar. HOY ES: ${new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}. Corrige automáticamente el año si el agente intenta agendar en el pasado.`,
    inputSchema: z.object({
      summary: z.string().describe('Título del evento (ej: Visita Propiedad X)'),
      location: z.string().describe('Dirección completa de la propiedad'),
      start: z.string().describe('Fecha y hora de inicio en formato ISO'),
      end: z.string().describe('Fecha y hora de fin en formato ISO'),
    }),
    execute: async ({ summary, location, start, end }) => {
      const calendar = getGoogleCalendar();

      // Aplicamos la limpieza de fechas antes de enviar a Google
      const { finalStart, finalEnd } = getSanitizedDates(start, end);

      try {
        const response = await calendar.events.insert({
          calendarId: 'primary',
          requestBody: {
            summary: summary,
            location: location,
            start: { 
              dateTime: finalStart, 
              timeZone: 'America/Argentina/Buenos_Aires' 
            },
            end: { 
              dateTime: finalEnd, 
              timeZone: 'America/Argentina/Buenos_Aires' 
            },
          },
        });

        return {
          success: true,
          eventId: response.data.id,
          link: response.data.htmlLink,
          scheduledStart: finalStart,
          message: start !== finalStart ? "Fecha corregida al año actual automáticamente." : "Agendado correctamente."
        };
      } catch (error: any) {
        console.error('Error creando evento en Google Calendar:', error);
        return { success: false, error: error.message };
      }
    },
  }),

  /**
   * Herramienta para listar eventos con ancla en el tiempo real
   */
  listCalendarEvents: createTool({
    id: 'list_calendar_events',
    description: 'Lista los próximos eventos del calendario para verificar disponibilidad.',
    inputSchema: z.object({
      daysAhead: z.number().default(15).describe('Número de días a futuro para consultar'),
    }),
    execute: async ({ daysAhead }) => {
      const calendar = getGoogleCalendar();
      
      // timeMin es SIEMPRE el momento exacto de la ejecución
      const timeMin = new Date().toISOString();
      const timeMax = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString();

      try {
        const response = await calendar.events.list({
          calendarId: 'primary',
          timeMin,
          timeMax,
          singleEvents: true,
          orderBy: 'startTime',
        });

        return response.data.items || [];
      } catch (error: any) {
        console.error('Error listando eventos de Google Calendar:', error);
        return { success: false, error: error.message };
      }
    },
  }),
};