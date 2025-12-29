import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import axios from 'axios';

const LOCATION_IQ_KEY = process.env.LOCATIONIQ_API_KEY; // Guárdala en tu .env

export const propiedadMasCercanaTool = createTool({
  id: 'encontrar_propiedad_cercana',
  description: 'Calcula la distancia entre una dirección nueva y las visitas agendadas en el calendario para optimizar la logística.',
  inputSchema: z.object({
    nueva_direccion: z.string().describe('La dirección de la propiedad que se quiere evaluar'),
    eventos_calendario: z.array(z.string()).describe('Lista de nombres de eventos'),
  }),
  execute: async (context) => {
    const { nueva_direccion, eventos_calendario } = context;

    // 1. Geocodificar la dirección base (nueva_direccion)
    const geoBase = await axios.get('https://us1.locationiq.com/v1/search.php', {
      params: { key: LOCATION_IQ_KEY, q: `${nueva_direccion}, Buenos Aires, Argentina`, format: 'json', limit: 1 }
    });
    
    const base = { lat: geoBase.data[0].lat, lon: geoBase.data[0].lon };

    // 2. Filtrar y procesar eventos (como hacías en el nodo 'Filtra_solo_visitas...')
    const visitas = eventos_calendario.filter((e: any) => e.summary?.toLowerCase().includes('visita'));

    const calculos = await Promise.all(visitas.map(async (evento: any) => {
      try {
        // Geocodificar ubicación del evento
        const geoEv = await axios.get('https://us1.locationiq.com/v1/search.php', {
          params: { key: LOCATION_IQ_KEY, q: `${evento.location}, Buenos Aires, Argentina`, format: 'json', limit: 1 }
        });

        // Calcular distancia real (Driving)
        const distRes = await axios.get(`https://us1.locationiq.com/v1/directions/driving/${base.lon},${base.lat};${geoEv.data[0].lon},${geoEv.data[0].lat}`, {
          params: { key: LOCATION_IQ_KEY }
        });

        return {
          direccion: evento.location,
          fecha: evento.start?.dateTime || evento.start,
          distancia_metros: distRes.data.routes[0].distance,
        };
      } catch (err) {
        return null;
      }
    }));

    // 3. Ranking final (Top 5)
    return calculos
      .filter((c: any) => c !== null)
      .sort((a: any, b: any) => a!.distancia_metros - b!.distancia_metros)
      .slice(0, 5);
  },
});