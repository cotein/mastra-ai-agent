
import 'dotenv/config';
import { propertyWorkflow } from "./property-intelligence";

async function main() {
  const url = "https://www.zonaprop.com.ar/propiedades/clasificado/alclapin-mitre-337-57754806.html?n_src=Listado&n_pg=1&n_pos=1";
  
  console.log(`Testing property-intelligence workflow with URL: ${url}`);

  try {
    const run = await propertyWorkflow.createRun();
    const result = await run.start({ inputData: { url } });
    
    console.log("Workflow Execution Status:", result.status);

    if (result.status === 'success' && result.result) {
        console.log("Workflow Output:", JSON.stringify(result.result, null, 2));
        
        const finalOutput = result.result;
        if (finalOutput.address && finalOutput.operacionTipo) {
             console.log("✅ Workflow verification passed!");
        } else {
             console.error("❌ Workflow verification passed but output fields missing");
        }
    } else {
        console.error("❌ Workflow failed:", result.status);
    }

  } catch (error) {
    console.error("❌ Workflow Execution Failed:", error);
  }
}

main();
