import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const getAvailableScheduleTool = createTool({
  id: "get-available-schedule",
  description: "Calcula horarios disponibles reales verificando conflictos y buffers de tiempo.",
  inputSchema: z.object({
    diasAAnalizar: z.number().default(5).describe("Cuántos días a futuro buscar"),
    duracionMinutos: z.number().default(40).describe("Duración de la visita"),
    bufferMinutos: z.number().default(30).describe("Tiempo de viaje entre visitas")
  }),
  outputSchema: z.object({
    availableSlots: z.array(z.object({
      fecha: z.string(),
      hora: z.string(),
      iso: z.string()
    }))
  }),
  execute: async ({ diasAAnalizar, duracionMinutos, bufferMinutos }) => {
    console.log("--> getAvailableScheduleTool: EXECUTE");
    console.log("    Inputs:", { diasAAnalizar, duracionMinutos, bufferMinutos });

    const now = new Date();
    const future = new Date();
    future.setDate(now.getDate() + diasAAnalizar);

    // 2. Definir ventana de trabajo (ej: 10:00 a 16:00)
    const workStartHour = 10;
    const workEndHour = 16;
    
    // TODO: Obtener busySlots de Google Calendar o sistema de reservas
    // Por ahora inicializamos como vacío para evitar errores
    const busySlots: { start: Date; end: Date }[] = []; 
    console.log("    BusySlots (mock):", busySlots.length);
    
    const availableSlots = [];

    // Lógica determinista de cálculo de huecos
    // Iteramos por día y por bloques de 15 mins (simplificado para el ejemplo)
    for (let d = 0; d < diasAAnalizar; d++) {
        let currentDate = new Date(now);
        currentDate.setDate(now.getDate() + d);
        
        // Saltar fines de semana si es necesario
        if (currentDate.getDay() === 0 || currentDate.getDay() === 6) continue;

        // Inicio del día laboral
        let timeCursor = new Date(currentDate);
        timeCursor.setHours(workStartHour, 0, 0, 0);
        
        const dayEnd = new Date(currentDate);
        dayEnd.setHours(workEndHour, 0, 0, 0);

        console.log(`    Checking date: ${currentDate.toLocaleDateString()}`);

        while (timeCursor < dayEnd) {
            const proposedEnd = new Date(timeCursor.getTime() + duracionMinutos * 60000);
            
            if (proposedEnd > dayEnd) break;
            const hasConflict = busySlots.some(busy => {
                const busyStartWithBuffer = new Date(busy.start.getTime() - bufferMinutos * 60000);
                const busyEndWithBuffer = new Date(busy.end.getTime() + bufferMinutos * 60000);
                
                return (
                    (timeCursor >= busyStartWithBuffer && timeCursor < busyEndWithBuffer) ||
                    (proposedEnd > busyStartWithBuffer && proposedEnd <= busyEndWithBuffer) ||
                    (timeCursor <= busyStartWithBuffer && proposedEnd >= busyEndWithBuffer)
                );
            });

            if (!hasConflict) {
                // Formato amigable para el LLM
                availableSlots.push({
                    fecha: timeCursor.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric' }),
                    hora: timeCursor.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
                    iso: timeCursor.toISOString() // Para uso interno si hace falta
                });
                
                // Si encontramos un hueco, saltamos para no ofrecer horarios pegados (ej: 10:00, 10:15...)
                // Opcional: Avanzar el cursor
                timeCursor = new Date(timeCursor.getTime() + 60 * 60000); // Avanzar 1 hora
            } else {
                timeCursor = new Date(timeCursor.getTime() + 15 * 60000); // Probar 15 mins después
            }
        }
    }

    console.log(`    Found ${availableSlots.length} available slots.`);
    if (availableSlots.length === 0) {
        console.log("    Returning empty slots.");
        return { availableSlots: [] };
    }

    // Retornamos máximo 5 opciones para no marear al usuario
    const result = availableSlots.slice(0, 5);
    console.log("    Returning slots:", JSON.stringify(result));
    return { availableSlots: result };
  }
});