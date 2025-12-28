import { Mastra } from '@mastra/core';
import { PostgresStore } from '@mastra/pg';
import 'dotenv/config';

async function seed() {
  // 1. Inicializamos el Storage
  const storage = new PostgresStore({
    connectionString: process.env.POSTGRES_URL!,
  });

  // 2. Definimos la propiedad (tu data)
  const description = `Casa en Venta 5 Ambientes en Temperley con Cochera Techada. 
  Living con hogar, galería, cocina funcional. Fondo con parrilla, lavadero y cochera.
  Planta alta: 3 dormitorios, baño completo y suite con vestidor. 
  Tercer planta: Altillo completo versátil.
  Ubicación: Cerca del club El Templo, a 5 min de estación Temperley y Lomas.
  Extras: Permite mascotas, Apto profesional, 3 plantas, Patio.`;

  const metadata = {
    precio: 185000,
    moneda: 'USD',
    localidad: 'Temperley',
    ambientes: 5,
    tipo: 'Venta',
    url_ficha: 'https://tu-web.com/propiedad/temperley-123'
  };

  console.log("⏳ Generando embedding con OpenAI...");

  // 3. Creamos una instancia temporal de Mastra para usar su motor de embeddings
  // (Asegúrate de tener OPENAI_API_KEY en tu .env)
  const mastra = new Mastra({});
  
  const embedding = await mastra.embed(description, {
    provider: 'OPENAI',
    model: 'text-embedding-3-small', // El que genera 1536 dimensiones
  });

  console.log("✅ Embedding generado. Insertando en Supabase...");

  // 4. Inserción directa en la tabla property_memory
  // Usamos la conexión del storage para ejecutar el insert
  const client = await storage.getPg6(); // Obtiene el cliente de pg-promise
  
  await client.none(
    `INSERT INTO public.property_memory (content, embedding, metadata) 
     VALUES ($1, $2, $3)`,
    [
      description,
      `[${embedding.join(',')}]`, // Convertimos el array de numbers a formato vector de Postgres
      JSON.stringify(metadata)
    ]
  );

  console.log("🎉 ¡Propiedad persistida con éxito!");
  process.exit(0);
}

seed().catch(console.error);