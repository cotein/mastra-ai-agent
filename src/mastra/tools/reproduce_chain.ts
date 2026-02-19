import 'dotenv/config'; 
import { tokkoPropertySearchTool } from "../tools/tokko-property-search";
import { extractAddressFromUrlTool } from "../tools/extract-address-from-url";
import { realEstatePropertyFormatterTool } from "../tools/real-estate-property-formatter";

async function main() {
  const url = "https://www.zonaprop.com.ar/propiedades/clasificado/alclapin-gorriti-368-56339731.html?n_src=Listado&n_pills=Lavadero&n_pg=1&n_pos=2";

  console.log(`1. Extracting address from ${url}...`);

  try {
    const extractExec = extractAddressFromUrlTool.execute as (input: { url: string }) => Promise<any>;
    const extractionResult = await extractExec({ url });
    
    console.log("Extraction Result:", JSON.stringify(extractionResult, null, 2));

    console.log("\n2. Calling Tokko Search...");
    const searchExec = tokkoPropertySearchTool.execute as (input: any) => Promise<any>; 
    
    const searchResult = await searchExec(extractionResult);

    if (searchResult.success) {
        console.log("✅ Tokko Search Success!");
        console.log("Objects found:", searchResult.data.objects?.length);
        
        if (searchResult.data.objects?.length > 0) {
            const prop = searchResult.data.objects[0];
            // console.log("Property:", JSON.stringify(prop, null, 2));
            console.log("\n--- Property Details ---");
            console.log(`Address: ${prop.address}`);
            
            console.log("\n3. Calling Property Formatter...");
            // Use rich_description if available, otherwise description
            const descriptionText = prop.rich_description || prop.description || "";
            
            const formatExec = realEstatePropertyFormatterTool.execute as (input: { keywordsZonaProp: string }) => Promise<any>;
            
            const formatResult = await formatExec({ keywordsZonaProp: descriptionText });
            
            console.log("\n✅ Formatter Result:");
            console.log(formatResult.formattedText);
        }
    } else {
        console.error("❌ Chain Failed:", searchResult.error);
    }

  } catch (error) {
    console.error("💥 Chain Error:", error);
  }
}

// main();
