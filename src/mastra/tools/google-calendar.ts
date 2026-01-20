import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { google } from 'googleapis';
import { naturalDateToISO8601 } from '../../helpers/date-converter';
import { llmDateParser } from './llm-date-parser';

const CALENDAR_ID = 'c.vogzan@gmail.com';


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
/**
 * LÓGICA DE VALIDACIÓN TEMPORAL (SENIOR LAYER)
 * Convierte cualquier input ISO (UTC o Local) a la hora "wall-clock" correcta
 * en la zona horaria objetivo (Argentina), preservando el instante exacto.
 */
const getSanitizedDates = (startIso: string, endIso: string) => {
  const timeZone = 'America/Argentina/Buenos_Aires';
  const now = new Date();
  
  // 1. Crear objetos Date (interpreta Z correctamente como UTC)
  let startDate = new Date(startIso);
  let endDate = new Date(endIso);

  // 2. Validar si es una fecha pasada (Alucinación de año)
  if (startDate < now) {
    console.log("Detectada fecha pasada, corrigiendo año...");
    startDate.setFullYear(startDate.getFullYear() + 1);
    endDate.setFullYear(endDate.getFullYear() + 1);
  }

  /**
   * Helper que formatea la fecha a la string ISO local "YYYY-MM-DDTHH:mm:ss"
   * correspondiente a la zona horaria 'America/Argentina/Buenos_Aires'.
   * 
   * Ej: Si entra 13:00Z (UTC), en Argentina son las 10:00.
   * Return esperado: "202X-MM-DDT10:00:00"
   */
  const toLocalIsoString = (date: Date) => {
    // Usamos sv-SE (Suecia) porque su formato local es ISO 8601 (YYYY-MM-DD HH:mm:ss)
    const options: Intl.DateTimeFormatOptions = { 
        timeZone, 
        year: 'numeric', 
        month: '2-digit', 
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    };
    
    // Format parts to ensure valid ISO construction
    // Hack: Intl.DateTimeFormat con 'sv-SE' da "YYYY-MM-DD HH:mm:ss", solo cambiamos " " por "T"
    const localString = new Intl.DateTimeFormat('sv-SE', options).format(date);
    return localString.replace(' ', 'T');
  };

  return {
    start: toLocalIsoString(startDate),
    end: toLocalIsoString(endDate)
  };
};

/**
 * HELPER: Parse Input Date (ISO or Natural Language)
 * Wraps chrono-node logic to ensure we always get a valid Date object.
 */
const parseDateInput = async (input: string): Promise<string> => {
  // 1. Try passing as standard Date (ISO)
  const isoDate = new Date(input);
  if (!isNaN(isoDate.getTime()) && input.includes('T')) {
      return input; // It's already a valid ISO string with time
  }

  // 2. If not ISO, try Natural Language Parsing (Delegated to Helper)
  console.log(`⚠️ Input date '${input}' is not strict ISO. Attempting Natural Language Parse via Helper...`);
  
  const result = naturalDateToISO8601(input);

  if (!result.success || !result.isoDate) {
      throw new Error(`No pude entender la fecha indicada: "${input}". Error: ${result.error || 'Desconocido'}. Por favor usa un formato más claro.`);
  }

  console.log(`✅ Smart Parse Success: '${input}' -> ${result.isoDate}`);
  return result.isoDate;
};

// export const calendarManagerTools = {
  /**
   * Herramienta para crear eventos con validación de año automática
   */
  export const createCalendarEvent = createTool({
    id: 'create_calendar_event',
    description: 'Registra citas de visitas inmobiliarias en el calendario oficial de Fausti. Esta herramienta DEBE ser usada cuando el cliente confirma un horario.',
    inputSchema: z.object({
      title: z.string().optional().describe('Título descriptivo del evento'),
      start: z.string().describe('Fecha y hora de inicio. Puede ser formato ISO8601 O texto natural (ej: "Lunes 20 a las 10hs", "Mañana 15:00").'),
      end: z.string().optional().describe('Fecha y hora de fin. Puede ser formato ISO8601 O texto natural.'),
      clientName: z.string().optional().describe("Nombre y Apellido del cliente"),
      clientPhone: z.string().optional().describe("Teléfono del cliente"),
      propertyAddress: z.string().optional().describe("Dirección de la propiedad"),
      propertyLink: z.string().optional().describe("Link de la propiedad"),
    }),
    execute: async (input) => {
      console.log("🛠️ [TOOL START] create_calendar_event iniciado");
      console.log("📊 [PARAMS] Parámetros recibidos del agente:", JSON.stringify(input, null, 2));
      
      const calendar = getGoogleCalendar();
      console.log("🔐 [AUTH] getGoogleCalendar() ejecutado. Cliente autenticado OK.");
      const calendarId = CALENDAR_ID;
      console.log(`📅 [CONFIG] Usando Calendar ID: ${calendarId}`);
      
      try {
        // 0. Smart Parsing con LLM (O bypass si es ISO válido)
        let smartStart: string;
        let smartEnd: string;

        // Comprobamos si start ya es un ISO válido (Viene de get_available_slots)
        const isIsoStart = !isNaN(Date.parse(input.start)) && input.start.includes('T');
        
        if (isIsoStart) {
            console.log("⚡ [FAST PATH] Detectado formato ISO. Saltando LLM Parser.");
            smartStart = input.start;
            
            // Si hay end y es ISO, lo usamos. Si no, default 1 hora.
            if (input.end && !isNaN(Date.parse(input.end)) && input.end.includes('T')) {
                smartEnd = input.end;
            } else {
                 const startDate = new Date(smartStart);
                 startDate.setHours(startDate.getHours() + 1);
                 smartEnd = startDate.toISOString();
            }
        } else {
            // Camino Lento: Texto Natural -> LLM
            console.log("🐢 [SLOW PATH] Detectado lenguaje natural. Invocando LLM Parser...");
            const dateDescription = input.end 
                ? `Inicio: ${input.start}. Fin: ${input.end}` 
                : input.start;

            const parseResult = await llmDateParser.execute!({ dateDescription });
            
            if (!parseResult.success || !parseResult.start) {
                throw new Error(`No pude entender la fecha: ${parseResult.error || 'error desconocido'}`);
            }
            smartStart = parseResult.start;
            smartStart = parseResult.start;
            smartEnd = parseResult.end!; 
        } 
        
        console.log(`🧠 [LLM PARSE RESULT] Start: ${smartStart}, End: ${smartEnd}`); 

        // Sanitización y conversión a hora local
        const { start, end } = getSanitizedDates(smartStart, smartEnd); // Si no hay end, usamos start (luego se ajusta duración si es necesario, pero idealmente debe venir)
        
        console.log(`🕒 [SANITIZED DATES] Start: ${start}, End: ${end} (Timezone: America/Argentina/Buenos_Aires)`);

        const eventSummary = input.title || `Visita Propiedad - ${input.clientName}`;
        
        const description = `visita propiedad - cliente: ${input.clientName} - tel: ${input.clientPhone || 'Sin tel'} - Domicilio: ${input.propertyAddress} - Link: ${input.propertyLink || 'Sin link'}`;

        console.log("🚀 [API REQUEST] Intentando crear evento con:", JSON.stringify({
            summary: eventSummary,
            start: start, 
            end: end,
            location: input.propertyAddress
        }, null, 2));

        const response = await calendar.events.insert({
          calendarId: calendarId,
          requestBody: {
            summary: eventSummary,
            location: input.propertyAddress,
            description: description,
            start: { 
              dateTime: start, // Ya viene formato "YYYY-MM-DDTHH:mm:ss" correcta para la TZ
              timeZone: 'America/Argentina/Buenos_Aires' 
            },
            end: { 
              dateTime: end, 
              timeZone: 'America/Argentina/Buenos_Aires' 
            },
          },
        });
        
        console.log("✅ [API SUCCESS] Evento creado. ID:", response.data.id);
        console.log("🔗 [API SUCCESS] Link:", response.data.htmlLink);

        return {
          success: true,
          eventId: response.data.id,
          link: response.data.htmlLink,
          scheduledStart: start,
          message: "Cita agendada correctamente con formato estandarizado."
        };
      } catch (error: any) {
        console.error('❌ [ERROR FATAL] Error creando evento en Google Calendar:', error);
        
        // Log extra details if it's a Google API error
        if (error.response) {
            console.error('📦 [GOOGLE API ERROR DATA]:', JSON.stringify(error.response.data, null, 2));
        }

        return { 
            success: false, 
            error: error.message,
            details: error.response ? error.response.data : "Error desconocido",
            rawError: JSON.stringify(error, Object.getOwnPropertyNames(error)) 
        };
      }
    },
  });

  /**
   * Herramienta para listar eventos con ancla en el tiempo real
   */
  export const listCalendarEvents = createTool({
    id: 'list_calendar_events',
    description: 'Lista los próximos eventos del calendario para verificar disponibilidad.',
    inputSchema: z.object({

      daysAhead: z.number().default(15).describe('Número de días a futuro para consultar'),
    }),
    execute: async (input) => {
      console.log("🛠️ Tool Invoked: list_calendar_events");
      console.log("📥 Input recibido:", JSON.stringify(input, null, 2));
      
      const { daysAhead } = input;
      const calendar = getGoogleCalendar();
      const calendarId = CALENDAR_ID;
      
      // timeMin es SIEMPRE el momento exacto de la ejecución
      const timeMin = new Date().toISOString();
      const timeMax = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString();

      try {
        const response = await calendar.events.list({
          calendarId,
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
  });

  /**
   * Herramienta para obtener un evento por ID
   */
  export const getCalendarEvent = createTool({
    id: 'get_calendar_event',
    description: 'Obtiene los detalles de un evento específico de Google Calendar usando su ID.',
    inputSchema: z.object({
      eventId: z.string().describe('ID del evento a obtener'),

    }),
    execute: async (input) => {
      console.log("🛠️ Tool Invoked: get_calendar_event");
      console.log("📥 Input recibido:", JSON.stringify(input, null, 2));

      const { eventId } = input;
      const calendar = getGoogleCalendar();
      const calendarId = CALENDAR_ID;
      try {
        const response = await calendar.events.get({
          calendarId,
          eventId: eventId,
        });
        return response.data;
      } catch (error: any) {
        console.error('Error obteniendo evento:', error);
        return { success: false, error: error.message };
      }
    },
  });

  /**
   * Herramienta para actualizar un evento existente
   */
  export const updateCalendarEvent = createTool({
    id: 'update_calendar_event',
    description: 'Actualiza un evento existente en Google Calendar. Puede cambiar horario, título, descripción o ubicación. ADMITE DATOS ESTRUCTURADOS.',
    inputSchema: z.object({
      eventId: z.string().describe('ID del evento a modificar'),

      summary: z.string().optional().describe('Nuevo título del evento'),
      description: z.string().optional().describe('Nueva descripción manual (NO RECOMENDADO - usar datos estructurados)'),
      location: z.string().optional().describe('Nueva ubicación'),
      start: z.string().optional().describe('Nueva fecha de inicio (ISO o Natural)'),
      end: z.string().optional().describe('Nueva fecha de fin (ISO o Natural)'),
      userEmail: z.string().optional().describe('Email del usuario para enviar notificaciones de actualización (opcional)'),
      clientEmail: z.string().optional().describe('Email del cliente'),

      // Datos Estructurados para reconstrucción de formato
      clientName: z.string().optional().describe("Nombre y Apellido del cliente (para actualizar ficha)"),
      clientPhone: z.string().optional().describe("Teléfono del cliente"),
      propertyAddress: z.string().optional().describe("Dirección de la propiedad"),
      propertyLink: z.string().optional().describe("Link de la propiedad"),
    }),
    execute: async (input) => {
      console.log("🛠️ Tool Invoked: update_calendar_event");
      console.log("📥 Input recibido:", JSON.stringify(input, null, 2));

      const { eventId, summary, description, location, start, end, userEmail, clientName, clientPhone, clientEmail, propertyAddress, propertyLink } = input;
      const calendar = getGoogleCalendar();
      const calendarId = CALENDAR_ID;

      // Recuperar evento actual
      let currentEvent;
      try {
        const getRes = await calendar.events.get({ calendarId, eventId });
        currentEvent = getRes.data;
      } catch (e: any) {
        return { success: false, error: "Evento no encontrado: " + e.message };
      }

      try {
          // Preparar fechas
          let startBody = currentEvent.start;
          let endBody = currentEvent.end;
          
          if (start && end) {
             const smartStart = await parseDateInput(start);
             const smartEnd = await parseDateInput(end);

             const { start: sanitizedStart, end: sanitizedEnd } = getSanitizedDates(smartStart, smartEnd);
             startBody = { dateTime: sanitizedStart.replace(/Z$/, ''), timeZone: 'America/Argentina/Buenos_Aires' };
             endBody = { dateTime: sanitizedEnd.replace(/Z$/, ''), timeZone: 'America/Argentina/Buenos_Aires' };
          }

          // LOGICA DE DESCRIPCIÓN:
          // 1. Si se pasa 'description' manual, se usa esa.
          // 2. Si NO se pasa manual, pero SÍ se pasan datos estructurados (aunque sea uno), se intenta reconstruir.
          //    Para reconstruir, necesitamos los valores faltantes. Intentamos sacarlos del evento actual o usar defaults.
          //    IMPORTANTE: Si el agente quiere actualizar solo el teléfono, DEBERÍA pasar el resto de datos para asegurar integridad.
          //    Sin embargo, podemos intentar parsear el 'currentEvent.description' si tiene el formato estándar, pero es frágil.
          //    Asumiremos que si usa datos estructurados, provee la información relevante.
          
          let finalDescription = description || currentEvent.description;

          if (!description && (clientName || clientPhone || clientEmail || propertyAddress || propertyLink)) {
              // Intentamos reconstruir usando los nuevos valores O defaults "a mantener" (que en realidad no tenemos).
              // Por seguridad, si el agente usa structured update, pedimos que pase lo que tenga.
              // Fallback a "Sin X" si no se provee, lo cual podría borrar info vieja si no se pasa.
              // Dado que el agente tiene contexto completo, lo correcto es que pase todo.
              const cName = clientName || "Cliente Actualizado";
              const cPhone = clientPhone || "Sin tel";
              const cEmail = clientEmail || "Sin email";
              const pAddress = propertyAddress || location || currentEvent.location || "Ver link";
              const pLink = propertyLink || "Sin link";

              finalDescription = `visita propiedad - cliente: ${cName} - tel: ${cPhone} - email: ${cEmail} - Domicilio: ${pAddress} - Link: ${pLink}`;
          }

          const requestBody: any = {
            ...currentEvent,
            summary: summary || currentEvent.summary,
            description: finalDescription,
            location: location || propertyAddress || currentEvent.location, // propertyAddress también actualiza location si se provee
            start: startBody,
            end: endBody,
          };

          const response = await calendar.events.update({
            calendarId,
            eventId: eventId,
            requestBody: requestBody,
            sendUpdates: userEmail ? 'all' : 'none', // Enviar correo si se provee email
          });

          return {
            success: true,
            eventId: response.data.id,
            link: response.data.htmlLink,
            updatedFields: { summary, location, start, end },
            message: "Evento actualizado correctamente."
          };
      } catch (error: any) {
        console.error('Error actualizando evento:', error);
        return { success: false, error: error.message };
      }
    },
  });

  /**
   * Herramienta para eliminar un evento
   */
  export const deleteCalendarEvent = createTool({
    id: 'delete_calendar_event',
    description: 'Elimina (cancela) un evento de Google Calendar permanentemente.',
    inputSchema: z.object({
      eventId: z.string().describe('ID del evento a eliminar'),

      notifyStart: z.boolean().optional().describe('No utilizado, pero mantenido por compatibilidad'),
    }),
    execute: async (input) => {
      console.log("🛠️ Tool Invoked: delete_calendar_event");
      console.log("📥 Input recibido:", JSON.stringify(input, null, 2));

      const { eventId } = input;
      const calendar = getGoogleCalendar();
      const calendarId = CALENDAR_ID;
      try {
        await calendar.events.delete({
          calendarId,
          eventId: eventId,
        });
        return { success: true, message: "Evento eliminado correctamente." };
      } catch (error: any) {
        console.error('Error eliminando evento:', error);
        return { success: false, error: error.message };
      }
    },
  });

  /**
   * Herramienta para obtener horarios disponibles
   */
  export const getAvailableSlots = createTool({
    id: 'get_available_slots',
    description: 'Obtiene slots de horarios disponibles de 10:00 a 16:00 para los próximos 5 días, excluyendo fines de semana.',
    inputSchema: z.object({}),
    execute: async () => {
      console.log("🛠️ [TOOL START] get_available_slots iniciado");
      
      try {
        const calendar = getGoogleCalendar();
        const now = new Date();
      const daysToCheck = 5;
      const workStartHour = 10;
      const workEndHour = 16;
      const slotDurationMinutes = 40; // Duración de visita
      const bufferMinutes = 30; // Tiempo de viaje/buffer

      const availableSlots = [];

      let daysFound = 0;
      let dayOffset = 1;

      while (daysFound < daysToCheck) {
        const currentDate = new Date(now);
        currentDate.setDate(now.getDate() + dayOffset);
        dayOffset++;

        // Saltar fines de semana (0 = Domingo, 6 = Sábado)
        const dayOfWeek = currentDate.getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) continue;
        
        // Si llegamos hasta aquí, es un día hábil
        daysFound++;

        // Definir rango del día laboral
        const dayStart = new Date(currentDate);
        dayStart.setHours(workStartHour, 0, 0, 0);
        const dayEnd = new Date(currentDate);
        dayEnd.setHours(workEndHour, 0, 0, 0);

        let timeCursor = new Date(dayStart);

        try {
          // Obtener eventos de este día
          const response = await calendar.events.list({
            calendarId: CALENDAR_ID,
            timeMin: dayStart.toISOString(),
            timeMax: dayEnd.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
          });
          const events = response.data.items || [];

          // Iterar slots candidatos
          while (timeCursor < dayEnd) {
            const proposedEnd = new Date(timeCursor.getTime() + slotDurationMinutes * 60000);

            if (proposedEnd > dayEnd) break;

            // Verificar conflictos
            const hasConflict = events.some((event: any) => {
                if (!event.start.dateTime || !event.end.dateTime) return false; // Eventos de día entero ignorados por ahora? Ojo
                
                const eventStart = new Date(event.start.dateTime);
                const eventEnd = new Date(event.end.dateTime);

                // Agregar buffer a los eventos existentes
                const busyStartWithBuffer = new Date(eventStart.getTime() - bufferMinutes * 60000);
                const busyEndWithBuffer = new Date(eventEnd.getTime() + bufferMinutes * 60000);

                return (
                    (timeCursor >= busyStartWithBuffer && timeCursor < busyEndWithBuffer) ||
                    (proposedEnd > busyStartWithBuffer && proposedEnd <= busyEndWithBuffer) ||
                    (timeCursor <= busyStartWithBuffer && proposedEnd >= busyEndWithBuffer)
                );
            });

            if (!hasConflict) {
                 availableSlots.push({
                    fecha: timeCursor.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric' }),
                    hora: timeCursor.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
                    iso: timeCursor.toISOString()
                });
                // Avanzar 1 hora para dar opciones espaciadas
                timeCursor = new Date(timeCursor.getTime() + 60 * 60000);
            } else {
                // Si hay conflicto, probar mover 15 mins
                timeCursor = new Date(timeCursor.getTime() + 15 * 60000);
            }
          }

        } catch (error) {
            console.error(`⚠️ Error fetching events for ${currentDate.toISOString()}:`, error);
        }
      }

      console.log(`✅ [TOOL END] get_available_slots finalizado. Slots encontrados: ${availableSlots.length}`);
      return availableSlots.slice(0, 5); // Retornar top 5
    } catch (criticalError: any) {
        console.error("❌ [CRITICAL ERROR] get_available_slots falló fatalmente:", criticalError);
        return { 
            success: false, 
            error: criticalError.message, 
            details: "Hubo un error interno consultando disponibilidad. Por favor intenta más tarde." 
        };
    }
    },
  });

  /**
   * Herramienta para buscar eventos usando lenguaje natural
   * Ej: "Lunes 12 de enero a las 12", "el lunes a mediodía"
   */
  export const findEventByNaturalDate = createTool({
    id: 'find_event_by_natural_date',
    description: 'Busca eventos en el calendario usando una fecha/hora en lenguaje natural (ej. "lunes 12 a las 12", "mañana al mediodía"). Retorna los eventos encontrados en esa fecha/hora exacta o aproximada.',
    inputSchema: z.object({
        query: z.string().describe('La fecha y hora en lenguaje natural. Ej: "Lunes 12 de enero a las 12", "12/01 a las 12:00"'),
    }),
    execute: async ({ query }) => {
      console.log("🛠️ Tool Invoked: find_event_by_natural_date");
      console.log("📥 Query recibido:", query);
        // Using static import 'es' from top of file
        const calendar = getGoogleCalendar();

        // 1 & 2. Parsear fecha usando el helper robusto
        const result = naturalDateToISO8601(query, { futureDate: false }); // futureDate: false porque quizas busquen algo pasado o "hoy"

        if (!result.success) {
            return { success: false, message: "No pude entender la fecha y hora indicadas. Por favor, intenta ser más específico." };
        }
        
        const date = result.date;
        // Asumimos que si el helper devolvió éxito, tenemos una fecha válida con hora (por default includeTime=true)
        // Pero para 'hasTime', el helper no expone ese detalle interno de chrono.
        // Asumiremos true si no es 00:00:00 O si date-converter lo infirió.
        // Como el helper pone una hora default si falta, tomemos eso como valido.
        const hasTime = true; 

        // 3. Definir ventana de búsqueda
        let timeMin: string;
        let timeMax: string;

        if (hasTime) {
            // Si hay hora, buscamos eventos que comiencen ALREDEDOR de esa hora.
            // Ventana: -5 minutos a +60 minutos (para cubrir la duración típica de una cita)
            // O mejor: Buscamos coincidencia exacta de inicio, pero con un pequeño margen por si el usuario dice "12:00" y es "12:05"
            // Para ser útil, vamos a buscar eventos que comiencen en el rango [hora - 15min, hora + 15min] 
            // O si el usuario pide "a las 12", quizás quiere ver si está libre o qué hay ahí.
            // La instrucción dice "retorne ESE evento". Asumimos que busca uno específico.
            
            const searchCenter = date.getTime();
            // Buscamos desde 1 hora antes hasta 1 hora después para asegurar encontrarlo
            // Pero filtramos luego para la coincidencia más cercana
            const minDate = new Date(searchCenter - 15 * 60000); // -15 mins
            const maxDate = new Date(searchCenter + 60 * 60000); // +60 mins (asumiendo que podría querer ver qué hay en esa hora)
            
            timeMin = minDate.toISOString();
            timeMax = maxDate.toISOString();
        } else {
             // Si solo es fecha (ej: "Lunes 12"), buscamos todo el día
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
                orderBy: 'startTime',
            });

            const events = response.data.items || [];

            if (events.length === 0) {
                const dateStr = date.toLocaleDateString('es-AR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
                const timeStr = hasTime ? ` a las ${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}` : '';
                return { 
                    success: true, 
                    events: [], 
                    message: `No encontré eventos para el ${dateStr}${timeStr}.`,
                    parsedDate: date.toISOString(),
                    isTimeSpecific: hasTime
                };
            }

            // Mapeamos a un formato legible
            const mappedEvents = events.map((e: any) => ({
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

        } catch (error: any) {
             console.error('Error buscando eventos por fecha natural:', error);
             return { success: false, error: error.message };
        }
    }
  });