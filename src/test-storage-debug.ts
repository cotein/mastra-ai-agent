
import 'dotenv/config';
import { PostgresStore } from "@mastra/pg";

async function testStorage() {
  console.log("Testing Postgres Storage Connection...");
  console.log("URL:", process.env.SUPABASE_POSTGRES_URL?.replace(/:([^@]+)@/, ':***@'));

  try {
    const storage = new PostgresStore({
      id: 'debug-store',
      connectionString: process.env.SUPABASE_POSTGRES_URL!,
      tableName: 'chat_messages', 
    });

    console.log("Storage instance created.");
    
    // Attempt to initialize (this usually checks/creates tables)
    // Note: ensure init() exists or simulate a write
    if (typeof storage.init === 'function') {
        console.log("Calling storage.init()...");
        await storage.init();
        console.log("storage.init() successful.");
    }

    console.log("Attempting to save a test message...");
    const result = await storage.saveMessages({
        sessionId: 'test-session-debug-001',
        messages: [{
            id: 'msg-debug-001',
            role: 'user',
            content: 'Hello from debug script',
            createdAt: new Date(),
        }]
    });
    
    console.log("Save result:", result);
    console.log("✅ Test finished. Check table 'chat_messages'.");

  } catch (error) {
    console.error("❌ Error testing storage:", error);
  }
}

testStorage();
