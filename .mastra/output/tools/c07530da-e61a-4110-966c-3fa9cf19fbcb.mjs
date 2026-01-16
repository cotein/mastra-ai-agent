import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const getAvailableScheduleTool = createTool({
  id: "get-available-schedule",
  description: "Calcula horarios disponibles reales verificando conflictos y buffers de tiempo.",
  inputSchema: z.object({
    diasAAnalizar: z.number().default(5).describe("Cu\xE1ntos d\xEDas a futuro buscar"),
    duracionMinutos: z.number().default(40).describe("Duraci\xF3n de la visita"),
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
    const now = /* @__PURE__ */ new Date();
    const future = /* @__PURE__ */ new Date();
    future.setDate(now.getDate() + diasAAnalizar);
    const workStartHour = 10;
    const workEndHour = 16;
    const busySlots = [];
    console.log("    BusySlots (mock):", busySlots.length);
    const availableSlots = [];
    for (let d = 0; d < diasAAnalizar; d++) {
      let currentDate = new Date(now);
      currentDate.setDate(now.getDate() + d);
      if (currentDate.getDay() === 0 || currentDate.getDay() === 6) continue;
      let timeCursor = new Date(currentDate);
      timeCursor.setHours(workStartHour, 0, 0, 0);
      const dayEnd = new Date(currentDate);
      dayEnd.setHours(workEndHour, 0, 0, 0);
      console.log(`    Checking date: ${currentDate.toLocaleDateString()}`);
      while (timeCursor < dayEnd) {
        const proposedEnd = new Date(timeCursor.getTime() + duracionMinutos * 6e4);
        if (proposedEnd > dayEnd) break;
        const hasConflict = busySlots.some((busy) => {
          const busyStartWithBuffer = new Date(busy.start.getTime() - bufferMinutos * 6e4);
          const busyEndWithBuffer = new Date(busy.end.getTime() + bufferMinutos * 6e4);
          return timeCursor >= busyStartWithBuffer && timeCursor < busyEndWithBuffer || proposedEnd > busyStartWithBuffer && proposedEnd <= busyEndWithBuffer || timeCursor <= busyStartWithBuffer && proposedEnd >= busyEndWithBuffer;
        });
        if (!hasConflict) {
          availableSlots.push({
            fecha: timeCursor.toLocaleDateString("es-AR", { weekday: "long", day: "numeric" }),
            hora: timeCursor.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }),
            iso: timeCursor.toISOString()
            // Para uso interno si hace falta
          });
          timeCursor = new Date(timeCursor.getTime() + 60 * 6e4);
        } else {
          timeCursor = new Date(timeCursor.getTime() + 15 * 6e4);
        }
      }
    }
    console.log(`    Found ${availableSlots.length} available slots.`);
    if (availableSlots.length === 0) {
      console.log("    Returning empty slots.");
      return { availableSlots: [] };
    }
    const result = availableSlots.slice(0, 5);
    console.log("    Returning slots:", JSON.stringify(result));
    return { availableSlots: result };
  }
});

export { getAvailableScheduleTool };
