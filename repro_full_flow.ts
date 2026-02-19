
import 'dotenv/config';
import { ThreadContextService, storage } from './src/mastra/storage';
import { getRealEstateAgent } from './src/mastra/agents/real-estate-agent';

(async () => {
    console.log("🚀 Starting Full Flow Verification (DB + Agent)");
    
    const threadId = "test_thread_" + Date.now();
    const userId = "test_user";

    try {
        // 1. Test Storage Init
        console.log("1️⃣ Initializing Storage...");
        // storage.init() might be needed if it's not auto-init? 
        // In index.ts it awaits storage.init() 
        // But storage is exported as initialized PostgresStore instance? 
        // valid check: await storage.init() is in index.ts line 30.
        // Let's check storage.ts again... it exports `storage` as `new PostgresStore`.
        // PostgresStore has .init()? likely.
        
        // 2. Test ThreadContextService (DB)
        console.log("2️⃣ Testing ThreadContextService.updateContext...");
        await ThreadContextService.updateContext(threadId, userId, { 
            test: "data", 
            timestamp: Date.now() 
        });
        console.log("✅ updateContext success");

        console.log("3️⃣ Testing ThreadContextService.getContext...");
        const ctx = await ThreadContextService.getContext(threadId);
        console.log("✅ getContext result:", ctx);

        // 3. Test Agent Instantiation (uses vector store)
        console.log("4️⃣ Testing Agent Instantiation...");
        const agent = await getRealEstateAgent(userId, "System Prompt override", "ALQUILAR");
        
        // 4. Test Agent Generation (simple)
        console.log("5️⃣ Testing Agent Generation...");
        const response = await agent.generate("Hola, esto es una prueba de conectividad.", {
             threadId: threadId,
             resourceId: userId
        });
        console.log("✅ Agent Response:", response.text.substring(0, 50) + "...");

    } catch (err) {
        console.error("💥 Full Flow Failed:", err);
    }
})();
