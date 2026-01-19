
import { es } from 'chrono-node';
import { 
  formatISO, 
  startOfDay, 
  addDays, 
  setHours, 
  setMinutes,
  setSeconds,
  setMilliseconds,
  parseISO,
  isValid
} from 'date-fns';


/**
 * Opciones para la conversión de fecha
 */
export interface DateConversionOptions {
  /** Fecha de referencia para cálculos relativos (por defecto: ahora) */
  referenceDate?: Date;
  /** Zona horaria para el formato de salida */
  timezone?: 'local' | 'utc';
  /** Si se debe incluir la hora en el resultado (por defecto: true) */
  includeTime?: boolean;
  /** Si se debe forzar la fecha futura (por defecto: true) */
  futureDate?: boolean;
}

/**
 * Resultado de la conversión
 */
export interface ConversionResult {
  /** Fecha en formato ISO 8601 */
  isoDate: string;
  /** Objeto Date resultante */
  date: Date;
  /** Si la conversión fue exitosa */
  success: boolean;
  /** Mensaje de error si hubo alguno */
  error?: string;
}

/**
 * Convierte una fecha en lenguaje natural a formato ISO 8601
 * @param naturalDate - Fecha en lenguaje natural (ej: "martes a las 10", "mañana a las 15:30")
 * @param options - Opciones de configuración
 * @returns Resultado de la conversión
 */
export function naturalDateToISO8601(
  naturalDate: string, 
  options: DateConversionOptions = {}
): ConversionResult {
  try {
    // Configuración por defecto
    const config: Required<DateConversionOptions> = {
      referenceDate: new Date(),
      timezone: 'local',
      includeTime: true,
      futureDate: true,
      ...options
    };

    // Validar entrada
    if (!naturalDate || typeof naturalDate !== 'string') {
      throw new Error('La fecha debe ser una cadena de texto');
    }

    // Normalizar el texto de entrada
    const normalizedInput = normalizeInput(naturalDate);
    
    // Intentar con patrones específicos primero
    const specificPatternResult = trySpecificPatterns(normalizedInput, config);
    
    let resultDate: Date;
    
    if (specificPatternResult) {
      resultDate = specificPatternResult;
    } else {
      // Usar chrono-node (ES) para parsing más complejo
      const chronoResults = es.parse(normalizedInput, config.referenceDate);
      
      if (!chronoResults || chronoResults.length === 0) {
        throw new Error(`No se pudo interpretar la fecha: "${naturalDate}"`);
      }
      
      const parsedResult = chronoResults[0];
      resultDate = parsedResult.start.date();
      
      // Si no tiene hora específica y se requiere incluir hora, usar hora por defecto
      if (!parsedResult.start.isCertain('hour') && config.includeTime) {
        resultDate = setDefaultTime(resultDate, config);
      }
    }
    
    // Validar la fecha resultante
    if (!isValid(resultDate)) {
      throw new Error('La fecha resultante no es válida');
    }
    
    // Ajustar para fecha futura si es necesario
    if (config.futureDate && resultDate < config.referenceDate) {
      // Si es un día de la semana, mover a la próxima semana
      const dayOfWeek = resultDate.getDay();
      const daysToAdd = dayOfWeek >= 0 ? 7 : 0;
      resultDate = addDays(resultDate, daysToAdd);
    }
    
    // Formatear según las opciones
    const isoDate = formatAccordingToOptions(resultDate, config);
    
    return {
      isoDate,
      date: resultDate,
      success: true
    };
    
  } catch (error) {
    return {
      isoDate: '',
      date: new Date(NaN),
      success: false,
      error: error instanceof Error ? error.message : 'Error desconocido'
    };
  }
}

/**
 * Normaliza el texto de entrada
 */
function normalizeInput(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Quitar acentos
    .replace(/\s+/g, ' ') // Espacios múltiples a uno
    .replace(/(\d)\s*([ap]\.?\s*m\.?)/gi, '$1$2') // Unir hora con AM/PM
    .replace(/\./g, '') // Quitar puntos
    .trim();
}

/**
 * Maneja patrones específicos comunes en español
 */
function trySpecificPatterns(
  text: string, 
  config: Required<DateConversionOptions>
): Date | null {
  const today = startOfDay(config.referenceDate);
  
  // Mapeo de días de la semana
  const weekDaysMap: Record<string, number> = {
    'lunes': 1,
    'martes': 2,
    'miercoles': 3,
    'jueves': 4,
    'viernes': 5,
    'sabado': 6,
    'domingo': 0,
    'lun': 1,
    'mar': 2,
    'mie': 3,
    'jue': 4,
    'vie': 5,
    'sab': 6,
    'dom': 0
  };
  
  // Mapeo de referencias relativas
  const relativeDaysMap: Record<string, number> = {
    'hoy': 0,
    'ahora': 0,
    'manana': 1,
    'mañana': 1,
    'pasado manana': 2,
    'pasado mañana': 2,
    'ayer': -1,
    'anteayer': -2,
    'ante ayer': -2
  };
  
  // Patrones simples sin hora
  for (const [key, offset] of Object.entries(relativeDaysMap)) {
    if (text === key) {
      return offset === 0 ? new Date(config.referenceDate) : addDays(today, offset);
    }
  }
  
  // Días de la semana sin hora
  for (const [dayName, dayNumber] of Object.entries(weekDaysMap)) {
    if (text === dayName || text === `el ${dayName}`) {
      return getNextWeekday(today, dayNumber, config.futureDate);
    }
  }
  
  // Patrones con hora
  const timePatterns: Array<{
    pattern: RegExp;
    handler: (match: RegExpMatchArray, today: Date) => Date;
  }> = [
    // Formato: "jueves 22 a las 10" (Día + Número + Hora)
    {
      // Quitamos ^ para permitir texto previo ("dale jueves...")
      pattern: /(?:^|\s)(?:el\s+)?(lunes|martes|miercoles|jueves|viernes|sabado|domingo|lun|mar|mie|jue|vie|sab|dom)\s+(\d{1,2})\s+(?:de\s+[^0-9]+\s+)?(a\s+las?|alas|a\s+la)\s+(\d{1,2})(?::(\d{2}))?\s*([ap]m)?/i,
      handler: (match, today) => {
        // match[1] = dia semana
        const dayNumber = parseInt(match[2]); // Was match[3]
        const hour = parseInt(match[4]);     // Was match[5]
        const minute = match[5] ? parseInt(match[5]) : 0; // Was match[6]
        const ampm = match[6] || '';         // Was match[7]
        
        // Calcular fecha basada en el número de día (mes actual o próximo)
        let date = new Date(config.referenceDate);
        const currentDay = date.getDate();
        
        // Si el día solicitado es menor al actual, asumimos próximo mes (salvo configuración futureDate=false)
        if (config.futureDate && dayNumber < currentDay) {
           // Mover al mes siguiente
           date.setMonth(date.getMonth() + 1);
        }
        
        // Setear el día específico
        date.setDate(dayNumber);
        
        return setTimeWithAMPM(date, hour, minute, ampm);
      }
    },

    // Formato: "martes a las 10"
    {
      pattern: /(?:^|\s)(?:el\s+)?(lunes|martes|miercoles|jueves|viernes|sabado|domingo|lun|mar|mie|jue|vie|sab|dom)\s+(a\s+las?|alas)\s+(\d{1,2})(?::(\d{2}))?\s*([ap]m)?/i,
      handler: (match, today) => {
        const dayName = match[1]; // Was match[1] (Wait, check logic below)
        // Regex: (?:^|\s)(?:el\s+)?(lunes|...) <=> Group 1.
        // So match[1] is correct for DayName.
        
        const hour = parseInt(match[3]); // Was match[4]. Group 2 is (alas). Group 3 is Hour.
        const minute = match[4] ? parseInt(match[4]) : 0; // Was match[5]
        const ampm = match[5] || '';     // Was match[6]
        const dayNumber = weekDaysMap[dayName];
        
        let date = getNextWeekday(today, dayNumber, config.futureDate);
        return setTimeWithAMPM(date, hour, minute, ampm);
      }
    },
    
    // Formato: "mañana a las 15:30"
    {
      pattern: /(?:^|\s)(hoy|manana|mañana|pasado manana|pasado mañana|ayer|anteayer|ante ayer)\s+(a\s+las?|alas)\s+(\d{1,2})(?::(\d{2}))?\s*([ap]m)?/i,
      handler: (match, today) => {
        const dayRef = match[1];
        const hour = parseInt(match[3]);
        const minute = match[4] ? parseInt(match[4]) : 0;
        const ampm = match[5] || '';
        const offset = relativeDaysMap[dayRef] || 0;
        
        let date = offset === 0 ? new Date(config.referenceDate) : addDays(today, offset);
        return setTimeWithAMPM(date, hour, minute, ampm);
      }
    },
    
    // Formato: "a las 10" o "a las 10:30"
    {
      pattern: /(?:^|\s)(a\s+las?|alas)\s+(\d{1,2})(?::(\d{2}))?\s*([ap]m)?/i,
      handler: (match, today) => {
        const hour = parseInt(match[2]);
        const minute = match[3] ? parseInt(match[3]) : 0;
        const ampm = match[4] || '';
        
        let date = config.futureDate && config.referenceDate.getHours() > hour 
          ? addDays(today, 1) 
          : new Date(config.referenceDate);
        
        return setTimeWithAMPM(date, hour, minute, ampm);
      }
    },
    
    // Formato: "en 3 días a las 14"
    {
      pattern: /^en\s+(\d+)\s+d[ií]as?\s+(a\s+las?|alas)\s+(\d{1,2})(?::(\d{2}))?\s*([ap]m)?$/,
      handler: (match, today) => {
        const days = parseInt(match[1]);
        const hour = parseInt(match[3]);
        const minute = match[4] ? parseInt(match[4]) : 0;
        const ampm = match[5] || '';
        
        let date = addDays(today, days);
        return setTimeWithAMPM(date, hour, minute, ampm);
      }
    },
    
    // Formato: "10 de la mañana" o "2 de la tarde"
    {
      pattern: /^(\d{1,2})\s+(de\s+la\s+)?(manana|mañana|tarde|noche)$/,
      handler: (match, today) => {
        const hour = parseInt(match[1]);
        const period = match[3];
        
        let adjustedHour = hour;
        if (period === 'tarde' && hour < 12) adjustedHour += 12;
        if (period === 'noche' && hour < 12) adjustedHour += 12;
        if (period === 'manana' || period === 'mañana') {
          adjustedHour = hour === 12 ? 0 : hour;
        }
        
        let date = config.futureDate && config.referenceDate.getHours() > adjustedHour 
          ? addDays(today, 1) 
          : new Date(config.referenceDate);
        
        return setHours(setMinutes(date, 0), adjustedHour);
      }
    },
    
    // Formato: "esta tarde" o "esta noche"
    {
      pattern: /^(esta|esta misma)\s+(manana|mañana|tarde|noche)$/,
      handler: (match, today) => {
        const period = match[2];
        const now = config.referenceDate;
        
        let hour = 0;
        switch (period) {
          case 'manana':
          case 'mañana':
            hour = 9; // 9 AM por defecto
            break;
          case 'tarde':
            hour = 15; // 3 PM por defecto
            break;
          case 'noche':
            hour = 20; // 8 PM por defecto
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
  
  // Probar todos los patrones
  for (const { pattern, handler } of timePatterns) {
    const match = text.match(pattern);
    if (match) {
      return handler(match, today);
    }
  }
  
  return null;
}

/**
 * Obtiene el próximo día de la semana específico
 */
function getNextWeekday(
  fromDate: Date, 
  targetWeekday: number, 
  futureDate: boolean = true
): Date {
  const currentWeekday = fromDate.getDay();
  let daysToAdd = targetWeekday - currentWeekday;
  
  if (!futureDate && daysToAdd < 0) daysToAdd += 7;
  if (futureDate && daysToAdd <= 0) daysToAdd += 7;
  
  return addDays(fromDate, daysToAdd);
}

/**
 * Establece la hora con manejo de AM/PM
 */
function setTimeWithAMPM(
  date: Date, 
  hour: number, 
  minute: number, 
  ampm: string
): Date {
  let adjustedHour = hour;
  
  if (ampm) {
    const isPM = ampm.toLowerCase().startsWith('p');
    if (isPM && hour < 12) adjustedHour += 12;
    if (!isPM && hour === 12) adjustedHour = 0;
  } else if (hour < 12) {
    // Si no se especifica AM/PM y es temprano, asumir PM si es tarde
    const now = new Date();
    if (now.getHours() >= 12 && hour <= 4) {
      adjustedHour += 12;
    }
  }
  
  return setHours(setMinutes(setSeconds(setMilliseconds(date, 0), 0), minute), adjustedHour);
}

/**
 * Establece hora por defecto cuando no se especifica
 */
function setDefaultTime(date: Date, config: Required<DateConversionOptions>): Date {
  if (config.includeTime) {
    // Usar la hora actual como referencia
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

/**
 * Formatea la fecha según las opciones
 */
function formatAccordingToOptions(
  date: Date, 
  config: Required<DateConversionOptions>
): string {
  if (!config.includeTime) {
    return formatISO(date, { representation: 'date' });
  }
  
  if (config.timezone === 'utc') {
    return formatISO(date, { representation: 'complete' });
  }
  
  return formatISO(date);
}

/**
 * Función auxiliar para validar si un texto parece ser una fecha natural
 */
export function isNaturalDate(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  
  const normalized = normalizeInput(text);
  
  // Palabras clave comunes en fechas naturales
  const dateKeywords = [
    'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo',
    'hoy', 'manana', 'mañana', 'ayer', 'anteayer',
    'a las', 'alas', 'de la', 'tarde', 'noche', 'manana', 'mañana',
    'en', 'dias', 'días', 'semana', 'proximo', 'próximo', 'proxima', 'próxima'
  ];
  
  return dateKeywords.some(keyword => normalized.includes(keyword));
}

/**
 * Ejemplos de uso y pruebas
 */
export function runExamples(): void {
  const examples = [
    'martes a las 10',
    'mañana a las 15:30',
    'hoy a las 20',
    'viernes a las 9:00',
    'en 2 días a las 14',
    'a las 18:30',
    'pasado mañana a las 8',
    'ayer a las 23:45',
    'jueves alas 11',
    '10 de la mañana',
    '2 de la tarde',
    'esta tarde',
    'el lunes a las 14:30',
    'a las 10 am',
    'a las 3 pm'
  ];
  
  console.log('=== Ejemplos de conversión ===\n');
  
  examples.forEach(example => {
    const result = naturalDateToISO8601(example);
    console.log(`Entrada: "${example}"`);
    console.log(`Salida:  ${result.isoDate}`);
    console.log(`Éxito:   ${result.success}`);
    if (result.error) console.log(`Error:   ${result.error}`);
    console.log('---');
  });
  
  console.log('\n=== Con opciones personalizadas ===\n');
  
  // Ejemplo con referencia de fecha específica
  const referenceDate = new Date('2024-01-15T12:00:00'); // Un lunes
  const result = naturalDateToISO8601('martes a las 10', { referenceDate });
  console.log(`Referencia: ${referenceDate.toISOString()}`);
  console.log(`Entrada: "martes a las 10"`);
  console.log(`Salida:  ${result.isoDate}`);
}

// Exportar por defecto
export default naturalDateToISO8601;