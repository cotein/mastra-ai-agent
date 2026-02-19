
import 'dotenv/config'; // Load env vars first
import { propertyWorkflow } from './src/mastra/workflows/property-intelligence';

// Mock console.log to see steps clearly
const originalLog = console.log;
console.log = (...args) => {
    originalLog(`[WORKFLOW]`, ...args);
};

const testUrl = "https://www.zonaprop.com.ar/propiedades/clasificado/alclapin-mitre-337-57754806.html?n_src=Listado&n_pg=1&n_pos=1";

(async () => {
    console.log(`🚀 Starting workflow reproduction for URL: ${testUrl}`);
    try {
        const run = await propertyWorkflow.createRun();
        console.log("⏳ Workflow run created, starting...");
        
        const result = await run.start({ inputData: { url: testUrl } });
        console.log("✅ Workflow finished:", JSON.stringify(result, null, 2));

    } catch (err) {
        console.error("💥 Workflow failed:", err);
    }
})();
