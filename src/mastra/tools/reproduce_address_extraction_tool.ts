
import { extractAddressFromUrlTool } from "../tools/extract-address-from-url";

async function main() {
  const urls = [
      "https://www.zonaprop.com.ar/propiedades/clasificado/vecllcin-av-meeks-158-56673355.html?n_src=Listado&n_pg=1&n_pos=2",
      "https://www.zonaprop.com.ar/propiedades/clasificado/alclapin-gorriti-368-56339731.html",
      "https://www.zonaprop.com.ar/propiedades/clasificado/veclcain-garibaldi-1315-56922157.html"
  ];

  console.log("Testing Deterministic Address Extraction Tool...\n");

  const executeFn = extractAddressFromUrlTool.execute as (input: { url: string }) => Promise<any>;

  for (const url of urls) {
      console.log(`Processing: ${url}`);
      try {
        const result = await executeFn({ url });
        console.log("Result:", JSON.stringify(result, null, 2));
        
        const addressFilter = result.filters.find((f: any) => f[0] === "address");
        if (addressFilter) {
            console.log("✅ Extracted Address:", addressFilter[2]);
        } else {
            console.log("❌ Failed to extract address");
        }
        console.log("-".repeat(50));
      } catch (error) {
        console.error("Error:", error);
      }
  }
}

// main();
