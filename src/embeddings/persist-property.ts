import { Mastra } from '@mastra/core';
import { PostgresStore } from '@mastra/pg';
import 'dotenv/config';

async function persistScrapedProperty(rawScraperText: string, propertyUrl: string) {
  const storage = new PostgresStore({
    connectionString: process.env.POSTGRES_URL!,
  });

  // 1. LIMPIEZA: Extraemos lo importante para el Agente
  // Eliminamos ruido como "Seleccioná una o más preguntas", "Calculamos el nivel", etc.
  const cleanContent = rawScraperText
    .split('Preguntas para la inmobiliaria')[0] // Cortamos antes de las preguntas sugeridas
    .replace(/Avisarme si baja de precio/g, '')
    .trim();

  // 2. ESTRUCTURACIÓN DE METADATA
  // Extraemos datos clave manualmente o mediante lógica simple para filtros rápidos
  const metadata = {
    source: 'zonaprop',
    url: propertyUrl,
    precio_usd: 185000,
    localidad: 'Temperley',
    ambientes: 5,
    superficie_cubierta: '145m²',
    tags: ['mascotas permitidas', 'apto profesional', 'altillo', 'parrilla'],
    fecha_carga: new Date().toISOString()
  };

  console.log("🧠 Generando embedding para búsqueda semántica...");
  
  const mastra = new Mastra({});
  
  // Convertimos el texto limpio en un vector de 1536 dimensiones
  const embedding = await mastra.embed(cleanContent, {
    provider: 'OPENAI',
    model: 'text-embedding-3-small',
  });

  console.log("💾 Guardando en property_memory...");

  const db = await storage.getPg6(); 
  
  await db.none(
    `INSERT INTO public.property_memory (content, embedding, metadata) 
     VALUES ($1, $2, $3)`,
    [
      cleanContent,
      `[${embedding.join(',')}]`,
      JSON.stringify(metadata)
    ]
  );

  console.log("✅ Propiedad guardada exitosamente.");
}

// EJEMPLO DE USO:
const textoDelScraper = `Casa en Venta 5 Ambientes... (todo el texto que pegaste)`;
persistScrapedProperty(textoDelScraper, "https://www.zonaprop.com.ar/propiedades/ejemplo-123.html");