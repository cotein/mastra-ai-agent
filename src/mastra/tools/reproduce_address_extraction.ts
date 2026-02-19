
import { addressExtractionAgent } from "../agents/address-extraction-agent";
import { tokkoPropertySearchTool } from "../tools/tokko-property-search";

async function main() {
  const url = "https://www.zonaprop.com.ar/propiedades/clasificado/alclapin-gorriti-368-56339731.html";

  console.log(`1. Extracting address from ${url}...`);

  try {
    const response = await addressExtractionAgent.generate(`Extract address from: ${url}`);
    console.log("Result Raw:", response.text);
    
    let parsedParams;
    try {
        parsedParams = JSON.parse(response.text);
        console.log("✅ Valid JSON parsed from Agent");
    } catch (e) {
        console.error("❌ Invalid JSON from Agent");
        return;
    }

    console.log("\n2. Calling Tokko API with extracted params...");
    const toolExec = tokkoPropertySearchTool.execute as (input: any) => Promise<any>;
    const searchResult = await toolExec(parsedParams);

    if (searchResult.success) {
        console.log("✅ Tokko Search Success!");
        console.log("Objects found:", searchResult.data.objects?.length);
        if (searchResult.data.objects?.length > 0) {
            const prop = searchResult.data.objects[0];
            console.log(`Property Address: ${prop.address}`);
            console.log(`Property ID: ${prop.id}`);
            console.log(`Real Address: ${prop.real_address}`);
        } else {
            console.log("⚠️ No properties found with these filters.");
        }
    } else {
        console.error("❌ Tokko Search Failed:", searchResult.error);
    }

  } catch (error) {
    console.error("Error:", error);
  }
}

// main();
