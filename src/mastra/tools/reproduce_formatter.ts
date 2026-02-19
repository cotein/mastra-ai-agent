
import { formatPropertyDataTool } from "./format-property-data";

// Mock data similar to real response structure
const mockTokkoResponse = {
    success: true,
    data: {
        meta: { limit: 20, next: null, offset: 0, previous: null, total_count: 1 },
        objects: [{
            address: "Gorriti 7",
            description: "Hermoso local comercial, bien ubicado.",
            description_only: "Hermoso local comercial, bien ubicado.",
            operations: [
                {
                    operation_type: "Venta",
                    prices: [{ price: 130000, currency: "USD", period: 0, is_promotional: false }]
                },
                {
                    operation_type: "Alquiler",
                    prices: [{ price: 500000, currency: "ARS", period: 1, is_promotional: false }]
                }
            ],
            location: {
                name: "Lomas de Zamora",
                full_location: "Lomas de Zamora, Buenos Aires",
                id: 1,
                divisions: [],
                parent_division: "",
                short_location: "Lomas",
                state: "Buenos Aires",
                weight: 0,
                zip_code: "1832"
            }
        }]
    }
};

async function main() {
    console.log("Testing formatPropertyDataTool...");
    try {
        // @ts-ignore - bypassing strict type check for mock execution context
        const result = await formatPropertyDataTool.execute(mockTokkoResponse);
        console.log("Result:", JSON.stringify(result, null, 2));

        if (result.address === "Gorriti 7" && 
            result.operations[0].operation_type === "Venta" && 
            result.location.name === "Lomas de Zamora") {
            console.log("✅ Custom Formatter Test Passed!");
        } else {
            console.error("❌ Test Failed: Output structure incorrect.");
        }

    } catch (error) {
        console.error("❌ Execution Error:", error);
    }
}

// main();
