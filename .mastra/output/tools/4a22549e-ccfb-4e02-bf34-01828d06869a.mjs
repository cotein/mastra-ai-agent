import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import axios from 'axios';

const LOCATION_IQ_KEY = process.env.LOCATIONIQ_API_KEY;
const propiedadMasCercanaTool = createTool({
  id: "encontrar_propiedad_cercana",
  description: "Calcula la distancia entre una direcci\xF3n nueva y las visitas agendadas en el calendario para optimizar la log\xEDstica.",
  inputSchema: z.object({
    nueva_direccion: z.string().describe("La direcci\xF3n de la propiedad que se quiere evaluar"),
    eventos_calendario: z.array(z.any()).describe("Lista de eventos obtenidos del calendario")
  }),
  execute: async (context) => {
    const { nueva_direccion, eventos_calendario } = context;
    const geoBase = await axios.get("https://us1.locationiq.com/v1/search.php", {
      params: { key: LOCATION_IQ_KEY, q: `${nueva_direccion}, Buenos Aires, Argentina`, format: "json", limit: 1 }
    });
    const base = { lat: geoBase.data[0].lat, lon: geoBase.data[0].lon };
    const visitas = eventos_calendario.filter((e) => e.summary?.toLowerCase().includes("visita"));
    const calculos = await Promise.all(visitas.map(async (evento) => {
      try {
        const geoEv = await axios.get("https://us1.locationiq.com/v1/search.php", {
          params: { key: LOCATION_IQ_KEY, q: `${evento.location}, Buenos Aires, Argentina`, format: "json", limit: 1 }
        });
        const distRes = await axios.get(`https://us1.locationiq.com/v1/directions/driving/${base.lon},${base.lat};${geoEv.data[0].lon},${geoEv.data[0].lat}`, {
          params: { key: LOCATION_IQ_KEY }
        });
        return {
          direccion: evento.location,
          fecha: evento.start?.dateTime || evento.start,
          distancia_metros: distRes.data.routes[0].distance
        };
      } catch (err) {
        return null;
      }
    }));
    return calculos.filter((c) => c !== null).sort((a, b) => a.distancia_metros - b.distancia_metros).slice(0, 5);
  }
});

export { propiedadMasCercanaTool };
