
import 'dotenv/config';
import { Pool } from 'pg';

const connectionString = process.env.SUPABASE_POSTGRES_URL;

if (!connectionString) {
  console.error('❌ SUPABASE_POSTGRES_URL missing in .env');
  process.exit(1);
}

const pool = new Pool({ 
  connectionString,
});

async function cleanMemory() {
  const client = await pool.connect();
  try {
    console.log("🧹 Cleaning Mastra Memory...");
    
    // Nombres de tablas por defecto de Mastra/PostgresStore
    // Si usas prefix en PostgresStore, ajústalo aquí.
    const tables = ['mastra_messages', 'mastra_threads']; 
    
    for (const table of tables) {
        try {
            await client.query(`TRUNCATE TABLE ${table} CASCADE;`);
            console.log(`✅ Table '${table}' truncated.`);
        } catch (error: any) {
            if (error.code === '42P01') {
                console.log(`⚠️ Table '${table}' does not exist (skipping).`);
            } else {
                console.error(`❌ Error truncating '${table}':`, error);
            }
        }
    }

    console.log("\n✨ Memory clean complete. Please restart your agent.");
    
  } catch (err) {
    console.error('🔥 Error connecting to DB:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

cleanMemory();
