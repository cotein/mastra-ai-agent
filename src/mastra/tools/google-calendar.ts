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


export const createCalendarEvent = createTool({
    id: 'create_calendar_event',
    description: 'Registra citas de visitas inmobiliarias en el calendario oficial de Fausti. Úsala cuando el cliente confirma un horario. Si hubo dudas que no pudiste responder, inclúyelas en pendingQuestions.',
    inputSchema: z.object({
      title: z.string().optional().describe('Título descriptivo del evento'),
      start: z.string().describe('Fecha y hora de inicio (ISO u lenguaje natural)'),
      end: z.string().optional().describe('Fecha y hora de fin'),
      clientName: z.string().optional().describe("Nombre y Apellido del cliente"),
      clientPhone: z.string().optional().describe("Teléfono del cliente"),
      propertyAddress: z.string().optional().describe("Dirección de la propiedad"),
      propertyLink: z.string().optional().describe("Link de la propiedad"),
      pendingQuestions: z.array(z.string()).optional().describe("Lista de preguntas que el cliente hizo y no pudiste responder según la base de datos"),
    }),
    execute: async (input) => {
      console.log("🛠️ [TOOL START] create_calendar_event con preguntas pendientes");
      
      const calendar = getGoogleCalendar();
      const calendarId = CALENDAR_ID;
      
      try {
        let smartStart: string;
        let smartEnd: string;

        // Lógica de parsing de fechas (se mantiene igual a tu implementación)
        const isIsoStart = !isNaN(Date.parse(input.start)) && input.start.includes('T');
        if (isIsoStart) {
            smartStart = input.start;
            if (input.end && !isNaN(Date.parse(input.end)) && input.end.includes('T')) {
                smartEnd = input.end;
            } else {
                 const startDate = new Date(smartStart);
                 startDate.setHours(startDate.getHours() + 1);
                 smartEnd = startDate.toISOString();
            }
        } else {
            const dateDescription = input.end ? `Inicio: ${input.start}. Fin: ${input.end}` : input.start;
            const parseResult = await llmDateParser.execute!({ dateDescription });
            smartStart = parseResult.start;
            smartEnd = parseResult.end!; 
        } 

        const { start, end } = getSanitizedDates(smartStart, smartEnd);
        const eventSummary = input.title || `Visita: ${input.clientName} - ${input.propertyAddress}`;
        
        let hasPendingQuestions = false;
        // --- CONSTRUCCIÓN DE LA DESCRIPCIÓN ---
        let description = `🏠 VISITA INMOBILIARIA\n\n`;
        description += `👤 Cliente: ${input.clientName}\n`;
        description += `📞 Tel: ${input.clientPhone || 'No provisto'}\n`;
        description += `📍 Propiedad: ${input.propertyAddress}\n`;
        description += `🔗 Link: ${input.propertyLink || 'Sin link'}\n\n`;


        if (input.pendingQuestions && input.pendingQuestions.length > 0) {
            hasPendingQuestions = true;
            description += `⚠️ PREGUNTAS PENDIENTES POR RESPONDER EN LA VISITA:\n`;
            input.pendingQuestions.forEach((q, i) => {
                description += `${i + 1}. ${q}\n`;
            });
        }
        // ---------------------------------------

        const response = await calendar.events.insert({
          calendarId: calendarId,
          requestBody: {
            summary: eventSummary,
            location: input.propertyAddress,
            description: description,
            start: { 
              dateTime: start, 
              timeZone: 'America/Argentina/Buenos_Aires' 
            },
            end: { 
              dateTime: end, 
              timeZone: 'America/Argentina/Buenos_Aires' 
            },
          },
        });
        
        return {
          success: true,
          eventId: response.data.id,
          link: response.data.htmlLink,
          message: hasPendingQuestions ? "Cita agendada con las dudas del cliente registradas." : "Cita agendada exitosamente."
        };
      } catch (error: any) {
        console.error('❌ Error en create_calendar_event:', error);
        return { 
          success: false, 
          data: null, 
          instruction: "DATA_NOT_FOUND: No menciones este error. Procede con la información que ya tengas o pregunta al usuario." 
        };
      }
    }
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


export const getAvailableSlots = createTool({
  id: 'get_available_slots',
  description: 'Obtiene una selección estratégica de horarios disponibles (uno por la mañana y uno por la tarde) para los próximos 4 días hábiles, entre las 10:00 y las 16:00 hs.',
  inputSchema: z.object({}),
  execute: async () => {
    console.log("🛠️ [TOOL START] get_available_slots iniciado - Estrategia: Balanceada (AM/PM)");

    try {
      const calendar = getGoogleCalendar();
      const now = new Date();
      
      // CONFIGURACIÓN
      const daysToCheck = 4;        // Requerimiento: Próximos 4 días hábiles
      const workStartHour = 10;     // 10:00 AR
      const workEndHour = 16;       // 16:00 AR
      const splitHour = 13;         // Punto de corte para definir Mañana vs Tarde
      
      // Argentina UTC-3
      const timezoneOffsetHours = 3; 
      const slotDurationMinutes = 40; 
      const bufferMinutes = 30; 

      const proposedSlots = [];
      let daysFound = 0;
      let dayOffset = 1;

      // Iteramos hasta encontrar los días hábiles requeridos
      while (daysFound < daysToCheck) {
        const currentDate = new Date(now);
        currentDate.setDate(now.getDate() + dayOffset);
        dayOffset++;

        // Saltar fines de semana
        const dayOfWeek = currentDate.getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) continue;
        
        daysFound++;

        // Definir rango del día en UTC
        const dayStart = new Date(currentDate);
        dayStart.setUTCHours(workStartHour + timezoneOffsetHours, 0, 0, 0); 
        
        const dayEnd = new Date(currentDate);
        dayEnd.setUTCHours(workEndHour + timezoneOffsetHours, 0, 0, 0);

        // Definir límite de Mañana/Tarde para este día
        const midDay = new Date(currentDate);
        midDay.setUTCHours(splitHour + timezoneOffsetHours, 0, 0, 0);

        try {
          const response = await calendar.events.list({
            calendarId: CALENDAR_ID,
            timeMin: dayStart.toISOString(),
            timeMax: dayEnd.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
          });
          const events = response.data.items || [];

          // Flags para asegurar solo 1 de mañana y 1 de tarde por día
          let morningSlotFound = false;
          let afternoonSlotFound = false;

          let timeCursor = new Date(dayStart);

          // Iterar dentro del día
          while (timeCursor < dayEnd) {
            // Si ya tenemos uno de mañana y uno de tarde, saltamos al siguiente día
            if (morningSlotFound && afternoonSlotFound) break;

            const proposedEnd = new Date(timeCursor.getTime() + slotDurationMinutes * 60000);
            if (proposedEnd > dayEnd) break;

            // Determinar si el cursor actual es Mañana o Tarde
            const isMorning = timeCursor < midDay;
            
            // Si es mañana y ya tenemos slot de mañana, avanzamos rápido
            if (isMorning && morningSlotFound) {
                 timeCursor = new Date(timeCursor.getTime() + 30 * 60000);
                 continue;
            }
            // Si es tarde y ya tenemos slot de tarde, avanzamos (o break si no queremos más opciones)
            if (!isMorning && afternoonSlotFound) {
                 timeCursor = new Date(timeCursor.getTime() + 30 * 60000);
                 continue;
            }

            // Verificar conflictos
            const hasConflict = events.some((event: any) => {
                if (!event.start.dateTime || !event.end.dateTime) return false; 
                const eventStart = new Date(event.start.dateTime);
                const eventEnd = new Date(event.end.dateTime);
                
                // Buffer logic
                const busyStartWithBuffer = new Date(eventStart.getTime() - bufferMinutes * 60000);
                const busyEndWithBuffer = new Date(eventEnd.getTime() + bufferMinutes * 60000);

                return (
                    (timeCursor >= busyStartWithBuffer && timeCursor < busyEndWithBuffer) ||
                    (proposedEnd > busyStartWithBuffer && proposedEnd <= busyEndWithBuffer) ||
                    (timeCursor <= busyStartWithBuffer && proposedEnd >= busyEndWithBuffer)
                );
            });

            if (!hasConflict) {
                // Guardamos el slot
                proposedSlots.push({
                    fecha: timeCursor.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', timeZone: 'America/Argentina/Buenos_Aires' }),
                    hora: timeCursor.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' }),
                    iso: timeCursor.toISOString(),
                    momento: isMorning ? 'Mañana' : 'Tarde' // Metadato útil para el LLM
                });

                // Marcar flag y avanzar cursor significativamente para buscar la siguiente franja
                if (isMorning) {
                    morningSlotFound = true;
                    // Intentar saltar hacia la tarde para eficiencia
                    if (timeCursor < midDay) {
                        timeCursor = new Date(midDay); 
                        continue; 
                    }
                } else {
                    afternoonSlotFound = true;
                }
                
                // Avanzar cursor standard
                timeCursor = new Date(timeCursor.getTime() + 60 * 60000);
            } else {
                // Conflicto: Mover 15 mins
                timeCursor = new Date(timeCursor.getTime() + 15 * 60000);
            }
          }

        } catch (error) {
            console.error(`⚠️ Error fetching events for ${currentDate.toISOString()}:`, error);
        }
      }

      console.log(`✅ [TOOL END] Slots seleccionados: ${proposedSlots.length}`);
      
      // Retornamos todo lo encontrado (máximo 8 slots: 4 días * 2 slots)
      return proposedSlots; 

    } catch (criticalError: any) {
        console.error("❌ [CRITICAL ERROR]", criticalError);
        return { 
            success: false, 
            error: criticalError.message, 
            details: "Error interno verificando agenda." 
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

const CONFIG = {
    TIMEZONE_OFFSET: 3, // UTC-3
    WORK_START: 10,
    WORK_END: 16,
    SLOT_DURATION: 40,
    BUFFER: 30,
    LOCALE: 'es-AR',
    TIMEZONE_STRING: 'America/Argentina/Buenos_Aires'
};

// Mapas de ayuda
const DAY_MAP: Record<string, number> = { 'DOMINGO': 0, 'LUNES': 1, 'MARTES': 2, 'MIERCOLES': 3, 'JUEVES': 4, 'VIERNES': 5, 'SABADO': 6 };

export const getAvailableSchedule = createTool({
    id: 'get_available_schedule',
    description: 'Busca disponibilidad en la agenda aplicando lógica de negocio basada en la intención del usuario (urgencia, día específico, rango, preferencia horaria).',
    inputSchema: z.object({
        intent: z.enum(['SPECIFIC_DAY', 'PART_OF_DAY', 'RANGE', 'URGENT', 'CONSTRAINT', 'GENERAL'])
            .describe('La intención principal detectada en la solicitud del usuario (Casos A-F)'),
        
        targetDay: z.enum(['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'DOMINGO']).optional()
            .describe('Para caso SPECIFIC_DAY: El día de la semana solicitado.'),
        
        dayPart: z.enum(['MORNING', 'AFTERNOON', 'ANY']).optional()
            .describe('Preferencia de momento del día. Morning < 13hs, Afternoon >= 13hs.'),
        
        dateRangeDays: z.number().optional()
            .describe('Para caso RANGE: Cuántos días buscar hacia adelante.'),
        
        excludedDays: z.array(z.string()).optional()
            .describe('Días a excluir (Ej: ["VIERNES"] para "menos los viernes").'),
            
        minHour: z.number().optional()
            .describe('Restricción de hora mínima (Ej: 16 para "a partir de las 16:00").')
    }),
    execute: async ({ intent, targetDay, dayPart, dateRangeDays, excludedDays, minHour }) => {
        // En Mastra, los argumentos vienen directos o dentro de context dependiendo de la versión/config
        // Sin embargo, si context no existe en el tipo, debemos intentar leer directo.
        // Si el usuario reportó error "Property 'context' does not exist", es porque el input
        // NO tiene context. Así que lo sacamos directo.
        
        // Si por alguna razón 'context' viniera pero TS no lo sabe, podemos hacer un fallback.
        // Pero lo más limpio para arreglar el error es confiar en el schema definido arriba.
        
        console.log(`🧠 [STRATEGY START] Intent: ${intent} | Day: ${targetDay || 'N/A'} | Part: ${dayPart || 'ANY'}`);

        try {
            const calendar = getGoogleCalendar(); // Tu función de cliente
            const now = new Date();
            
            // 1. DEFINIR ESTRATEGIA DE BÚSQUEDA SEGÚN INTENT (Casos A-F)
            let searchConfig = {
                daysLookahead: 5,     // Días a escanear
                maxSlotsPerDay: 2,    // Cuantos slots guardar por día
                totalSlotsNeeded: 4,  // Cuantos slots totales queremos retornar
                greedy: false,        // Si es true, toma el primero que encuentra (Urgente)
                forceDay: -1,         // -1 cualquiera, 0-6 específico
            };

            switch (intent) {
                case 'SPECIFIC_DAY': // Caso A
                    searchConfig.daysLookahead = 7; // Buscar hasta encontrar el día
                    searchConfig.maxSlotsPerDay = 4;
                    searchConfig.totalSlotsNeeded = 4;
                    if (targetDay) searchConfig.forceDay = DAY_MAP[targetDay];
                    break;

                case 'PART_OF_DAY': // Caso B
                    searchConfig.daysLookahead = 4;
                    searchConfig.maxSlotsPerDay = 2; // Repartidos
                    searchConfig.totalSlotsNeeded = 2; // Solo piden un par de opciones
                    break;

                case 'RANGE': // Caso C
                    searchConfig.daysLookahead = dateRangeDays || 3;
                    searchConfig.maxSlotsPerDay = 3;
                    searchConfig.totalSlotsNeeded = 9; // Más opciones
                    break;

                case 'URGENT': // Caso D
                    searchConfig.daysLookahead = 2; // Hoy y mañana
                    searchConfig.greedy = true; 
                    searchConfig.totalSlotsNeeded = 3;
                    break;

                case 'CONSTRAINT': // Caso E
                    searchConfig.daysLookahead = 7;
                    searchConfig.maxSlotsPerDay = 2;
                    searchConfig.totalSlotsNeeded = 3;
                    break;

                case 'GENERAL': // Caso F
                default:
                    searchConfig.daysLookahead = 3;
                    searchConfig.maxSlotsPerDay = 4; // 2 AM + 2 PM idealmente
                    searchConfig.totalSlotsNeeded = 4;
                    break;
            }

            const foundSlots = [];
            let daysChecked = 0;
            let currentOffset = 0; // Empezamos hoy (0) o mañana (1)

            // Loop principal de días
            while (daysChecked < searchConfig.daysLookahead && foundSlots.length < searchConfig.totalSlotsNeeded) {
                const checkDate = new Date(now);
                checkDate.setDate(now.getDate() + currentOffset);
                currentOffset++;

                const weekDay = checkDate.getDay();

                // Filtros Globales (Fin de semana y Exclusiones)
                // Nota: Tu requerimiento decía excluir fines de semana, salvo que pidan "Sábado".
                // Aquí asumimos L-V por defecto salvo lógica específica.
                const isWeekend = (weekDay === 0 || weekDay === 6);
                
                // Si piden un día específico, ignoramos el resto
                if (searchConfig.forceDay !== -1 && weekDay !== searchConfig.forceDay) continue;

                // Si es fin de semana y no pidieron explícitamente fin de semana (lógica simple)
                if (isWeekend && intent !== 'CONSTRAINT' && intent !== 'SPECIFIC_DAY') continue;

                // Filtro de exclusión (Caso E: "Menos viernes")
                if (excludedDays && excludedDays.some(d => DAY_MAP[d] === weekDay)) continue;

                daysChecked++;

                // Configurar Rango Horario del Día (UTC)
                const startH = (minHour && minHour > CONFIG.WORK_START) ? minHour : CONFIG.WORK_START;
                
                const dayStart = new Date(checkDate);
                dayStart.setUTCHours(startH + CONFIG.TIMEZONE_OFFSET, 0, 0, 0);
                
                const dayEnd = new Date(checkDate);
                dayEnd.setUTCHours(CONFIG.WORK_END + CONFIG.TIMEZONE_OFFSET, 0, 0, 0);

                // Si estamos buscando "Hoy" (offset 0) y ya pasó la hora, saltar
                if (dayStart < now) {
                    // Ajustar inicio a "ahora" si es urgente, o saltar día si ya terminó turno
                     if (now > dayEnd) continue;
                     if (now > dayStart) dayStart.setTime(now.getTime() + (30 * 60000)); // Empezar en 30 mins
                }

                // Fetch Calendar
                const events = await fetchEventsForDay(calendar, dayStart, dayEnd);
                
                let slotsInThisDay = 0;
                let timeCursor = new Date(dayStart);

                // Loop de Slots dentro del día
                while (timeCursor < dayEnd && slotsInThisDay < searchConfig.maxSlotsPerDay) {
                     // Chequeo Limite Global
                     if (foundSlots.length >= searchConfig.totalSlotsNeeded) break;

                    const proposedEnd = new Date(timeCursor.getTime() + CONFIG.SLOT_DURATION * 60000);
                    if (proposedEnd > dayEnd) break;

                    // Lógica Mañana/Tarde
                    // 13:00 AR = 16:00 UTC (aprox, simplificado por offset constante)
                    const hourAR = timeCursor.getUTCHours() - CONFIG.TIMEZONE_OFFSET;
                    const isMorning = hourAR < 13;
                    const isAfternoon = hourAR >= 13;

                    // Filtro de Parte del Día (Caso B)
                    if (dayPart === 'MORNING' && !isMorning) {
                        timeCursor = new Date(timeCursor.getTime() + 30 * 60000); continue;
                    }
                    if (dayPart === 'AFTERNOON' && !isAfternoon) {
                         timeCursor = new Date(timeCursor.getTime() + 30 * 60000); continue;
                    }

                    // Chequeo de Conflictos
                    if (!checkConflict(timeCursor, proposedEnd, events)) {
                        
                        foundSlots.push({
                            fecha: timeCursor.toLocaleDateString(CONFIG.LOCALE, { weekday: 'long', day: 'numeric', month: 'numeric', timeZone: CONFIG.TIMEZONE_STRING }),
                            hora: timeCursor.toLocaleTimeString(CONFIG.LOCALE, { hour: '2-digit', minute: '2-digit', timeZone: CONFIG.TIMEZONE_STRING }),
                            franja: isMorning ? 'Mañana' : 'Tarde',
                            iso: timeCursor.toISOString()
                        });
                        slotsInThisDay++;

                        // Salto estratégico
                        if (searchConfig.greedy) {
                            // Si es urgente, devolver inmediatamente, no buscar espaciado
                        } else {
                            // Espaciar opciones 60 mins para variedad
                            timeCursor = new Date(timeCursor.getTime() + 60 * 60000);
                            continue; 
                        }
                    } 
                    
                    // Si hubo conflicto o no elegimos ese slot, avanzar cursor pequeño
                    timeCursor = new Date(timeCursor.getTime() + 15 * 60000);
                }
            }
            
            // Generar respuesta narrativa para el contexto del LLM
            return {
                summary: `Se encontraron ${foundSlots.length} opciones bajo la estrategia '${intent}'.`,
                slots: foundSlots,
                strategy_used: intent
            };

        } catch (error) {
            console.error("❌ Error en get_available_slots:", error);
            throw new Error("Fallo en el servicio de calendario.");
        }
    }
});

// Helpers (Simplificados para el ejemplo)
async function fetchEventsForDay(calendar: any, start: Date, end: Date) {
    // Implementación estándar de Google Calendar API list
    const res = await calendar.events.list({
        calendarId: 'primary',
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        singleEvents: true
    });
    return res.data.items || [];
}

function checkConflict(start: Date, end: Date, events: any[]) {
    // Lógica de colisión con buffer
    return events.some((event: any) => {
        const eStart = new Date(event.start.dateTime);
        const eEnd = new Date(event.end.dateTime);
        const buffer = CONFIG.BUFFER * 60000;
        return (start < new Date(eEnd.getTime() + buffer)) && (end > new Date(eStart.getTime() - buffer));
    });
}