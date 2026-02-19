
import { tokkoPropertySearchTool } from "../tools/tokko-property-search";

async function main() {
  const inputParams = {
    "filters": [
      ["address", "contains", "magin roca 547"]
    ],
    "current_localization_type": "country",
    "current_localization_id": 1,
    "price_from": 0,
    "price_to": 99999999,
    "operation_types": [1, 2, 3],
    "property_types": [1, 2, 3, 4, 5, 6, 7, 8]
  };

  console.log("Testing Tokko Property Search Tool with params:");
  console.log(JSON.stringify(inputParams, null, 2));
  console.log("\nExecuting...");

  try {
    const toolExec = tokkoPropertySearchTool.execute as (input: any) => Promise<any>;
    const result = await toolExec(inputParams);

    if (result.success) {
      console.log("✅ Success!");
      console.log("Data received from Tokko:");
      // Log the meta data and the number of objects found
      console.log(`Title: ${result.data.meta?.title}`);
      console.log(`Total Objects Found: ${result.data.objects?.length}`);
      
      if (result.data.objects?.length > 0) {
        console.log("First Property Details:");
        const prop = result.data.objects[0];
        console.log(`- ID: ${prop.id}`);
        console.log(`- Address: ${prop.address}`);
        console.log(`- Real Address: ${prop.real_address}`);
        console.log(`- Operations:`, prop.operations?.map((op: any) => op.operation_type).join(", "));
      } else {
        console.log("⚠️ No properties found matching the criteria.");
      }

    } else {
      console.error("❌ Error executing tool:");
      console.error(result.error);
    }
  } catch (error) {
    console.error("💥 Unexpected error:", error);
  }
}

// main();
