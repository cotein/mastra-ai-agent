import { PostgresStore, PgVector } from "@mastra/pg";
import { Pool } from 'pg';
import { ClientData } from '../types';

const connectionString = process.env.SUPABASE_POSTGRES_URL!;

if (!connectionString) {
  throw new Error('❌ SUPABASE_POSTGRES_URL missing');
}

// Configura el Pool con límites explícitos para no saturar Supabase
const pool = new Pool({ 
  connectionString,
  max: 10, // Límite conservador para dejar espacio a las instancias de Mastra
  idleTimeoutMillis: 30000
});

// --- STORAGE MASTRA STANDARD ---
export const storage = new PostgresStore({
  id: 'pg-store',
  connectionString,
});

// --- RAG VECTOR STORE ---
export const vectorStore = new PgVector({
  id: 'pg-vector',
  connectionString,
  tableName: 'memory_messages',
  columnName: 'embedding',
  dims: 1536,
});

// Interfaz para tus metadatos (Best Practice)
interface AppMetadata {
  [key: string]: any;
  lastActive?: string;
  source?: string;
}

// --- CONTEXT SERVICE ---
export class ThreadContextService {
  
  static async getContext(threadId: string): Promise<AppMetadata> {
    const client = await pool.connect();
    try {
      const res = await client.query(
        `SELECT metadata FROM mastra_threads WHERE id = $1`, 
        [threadId]
      );
      return res.rows[0]?.metadata || {};
    } catch (err) {
      console.error('🔥 Error DB GetContext:', err);
      return {};
    } finally {
      client.release();
    }
  }

  static async updateContext(threadId: string, resourceId: string, newClientData: Record<string, any>) {
    if (!newClientData || Object.keys(newClientData).length === 0) {
        return;
    }

    const client = await pool.connect();
    try {
      const jsonString = JSON.stringify(newClientData);

      // MEJORA: No sobrescribimos el título si ya existe (DO UPDATE)
      // Y usamos COALESCE para el insert inicial
      const query = `
        INSERT INTO mastra_threads (id, "resourceId", title, metadata, "createdAt", "updatedAt")
        VALUES ($1, $2, 'Nueva Conversación', $3::jsonb, NOW(), NOW())
        ON CONFLICT (id) 
        DO UPDATE SET 
          metadata = COALESCE(mastra_threads.metadata, '{}'::jsonb) || EXCLUDED.metadata,
          "updatedAt" = NOW()
          -- Nota: No tocamos el title en el update para no borrar resúmenes previos
        RETURNING metadata; 
      `;
      
      const result = await client.query(query, [threadId, resourceId, jsonString]);
      // console.log("✅ [Storage] Metadata actualizada"); // Reducir logs en producción

    } catch (err) {
      console.error('🔥 [Storage] ERROR CRÍTICO AL GUARDAR:', err);
      // Opcional: throw err; // Depende de si quieres que la UI se entere del fallo
    } finally {
      client.release();
    }
  }

   static async getResourceProfile(resourceId: string): Promise<Partial<ClientData>> {
    if (!resourceId) return {};
    
    const client = await pool.connect();
    try {
      // Optimizamos query para traer solo lo necesario
      const res = await client.query(
        `SELECT "workingMemory" FROM mastra_resources WHERE id = $1 LIMIT 1`, 
        [resourceId]
      );
      
      const rawText = res.rows[0]?.workingMemory || "";
      if (!rawText) return {};

      // Helper robusto para extracción
      const extract = (key: string): string | undefined => {
        // Regex mejorado: Insensible a mayúsculas/minúsculas para la key (i flag)
        // y maneja espacios extra antes/después de los dos puntos
        const regex = new RegExp(`- \\*\\*${key}\\*\\*:\\s*(.*)`, 'i');
        const match = rawText.match(regex);
        return match && match[1].trim() ? match[1].trim() : undefined;
      };

      return {
        // Asegúrate que estas keys coincidan con tu Template de Mastra
        nombre: extract("First Name") || extract("Name"), // Fallback por si acaso
        apellido: extract("Last Name"),
        email: extract("Email"),
        telefono: extract("Phone") || extract("Teléfono"), 
      };

    } catch (err) {
      console.error('🔥 Error leyendo Mastra Resources:', err);
      return {};
    } finally {
      client.release();
    }
  }

  static async clearThreadMessages(threadId: string): Promise<void> {
    const client = await pool.connect();
    try {
      console.log(`🧹 [Storage] Limpiando historial para thread: ${threadId}`);
      // Asumiendo que 'mastra_messages' es la tabla donde se guardan los mensajes del chat
      // y que tiene una columna 'threadId' o similar. Ajustar según esquema real de Mastra.
      // En la implementación por defecto de PgMemory suele ser 'mastra_messages' con columna 'thread_id'.
      await client.query(
        `DELETE FROM mastra_messages WHERE "thread_id" = $1`, 
        [threadId]
      );
      console.log(`✅ [Storage] Historial eliminado exitosamente.`);
    } catch (err) {
      console.error('🔥 [Storage] Error al limpiar mensajes:', err);
    } finally {
      client.release();
    }
  }
}