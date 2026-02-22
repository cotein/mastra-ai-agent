
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { extractAddressFromUrlTool } from "../tools/extract-address-from-url";
import { tokkoPropertySearchTool } from "../tools/tokko-property-search";
import { realEstatePropertyFormatterTool } from "../tools/real-estate-property-formatter";

// Step 1: Extract Address
const extractAddressInputSchema = z.object({
  url: z.string().url(),
});

const extractAddressOutputSchema = z.object({
  filters: z.array(z.tuple([z.string(), z.string(), z.string()])),
  current_localization_type: z.string(),
  current_localization_id: z.number(),
  price_from: z.number(),
  price_to: z.number(),
  operation_types: z.array(z.number()),
  property_types: z.array(z.number()),
});

// Step 1: Extract Address
const extractAddressStep = createStep({
  id: "extract-address",
  inputSchema: extractAddressInputSchema,
  outputSchema: extractAddressOutputSchema,
  execute: async ({ inputData }) => {
    console.log("📍 [Step: extract-address] Starting with URL:", inputData.url);
    const result = await extractAddressFromUrlTool.execute!({
      url: inputData.url,
    }, {});
    if ('error' in result) {
        console.error("❌ [Step: extract-address] Failed:", result);
        throw new Error("Failed to extract address filters");
    }
    console.log("✅ [Step: extract-address] Completed. Address:", result.filters[0]); 
    return result as z.infer<typeof extractAddressOutputSchema>;
  },
});

// Step 2: Tokko Search
// Step 2: Tokko Search
const tokkoSearchInputSchema = z.object({
  filters: z.array(z.tuple([z.string(), z.string(), z.string()])),
  current_localization_type: z.string(),
  current_localization_id: z.number(),
  price_from: z.number(),
  price_to: z.number(),
  operation_types: z.array(z.number()),
  property_types: z.array(z.number()),
});

const tokkoSearchOutputSchema = z.object({
  success: z.boolean(),
  data: z.any(), // Using any to avoid complex schema duplication here, validated in tool
  error: z.string().optional(),
});

const tokkoSearchStep = createStep({
  id: "tokko-search",
  inputSchema: tokkoSearchInputSchema,
  outputSchema: tokkoSearchOutputSchema,
  execute: async ({ inputData }) => {
    console.log("📍 [Step: tokko-search] Starting search with filters:", JSON.stringify(inputData.filters));
    const result = await tokkoPropertySearchTool.execute!(inputData, {});
    
    if ('error' in result) {
         console.error("❌ [Step: tokko-search] Failed:", result);
         throw new Error("Failed to search properties");
    }

    const count = result.data?.objects?.length || 0;
    console.log(`✅ [Step: tokko-search] Completed. Found ${count} properties.`);
    
    return result as z.infer<typeof tokkoSearchOutputSchema>;
  },
});

// Step 3: Extract Requirements & Pets (Formatter)
// Step 3: Extract Requirements & Pets (Formatter)
const extractRequirementsInputSchema = z.object({
  success: z.boolean(),
  data: z.any(),
  error: z.string().optional(),
});

const extractRequirementsOutputSchema = z.object({
  formattedText: z.string(),
  rawProperty: z.any(),
});

const extractRequirementsStep = createStep({
  id: "extract-requirements",
  inputSchema: extractRequirementsInputSchema,
  outputSchema: extractRequirementsOutputSchema,
  execute: async ({ inputData }) => {
    console.log("📍 [Step: extract-requirements] Starting analysis on property data...");
    
    if (
      !inputData.success ||
      !inputData.data?.objects ||
      inputData.data.objects.length === 0
    ) {
      console.error("❌ [Step: extract-requirements] Validation Failed: No properties found.");
      throw new Error("No property found in Tokko search");
    }

    const property = inputData.data.objects[0];
    const description = property.rich_description || property.description || "";
    
    console.log(`ℹ️ [Step: extract-requirements] Property ID: ${property.id}, Description Length: ${description.length}`);

    console.log("   [Workflow] Extracting requirements from description...");
    const formatterResult = await realEstatePropertyFormatterTool.execute!({
      keywordsZonaProp: description,
    }, {});

    if ('error' in formatterResult) {
      console.error("❌ [Step: extract-requirements] Validation Failed:", formatterResult);
      throw new Error("Failed to extract requirements");
    }

    console.log("✅ [Step: extract-requirements] Completed analysis.");
    return {
      formattedText: formatterResult.formattedText,
      rawProperty: property,
    } as z.infer<typeof extractRequirementsOutputSchema>;
  },
});

// Step 4: Transform Output
// Step 4: Transform Output
const transformOutputInputSchema = z.object({
  formattedText: z.string(),
  rawProperty: z.any(),
});

const transformOutputOutputSchema = z.object({
  propiedadInfo: z.string(),
  operacionTipo: z.enum(["ALQUILAR", "VENDER", ""]),
  address: z.string(),
  mascotas: z.string(),
  requisitos: z.string(),
});

const transformOutputStep = createStep({
  id: "transform-output",
  inputSchema: transformOutputInputSchema,
  outputSchema: transformOutputOutputSchema,
  execute: async ({ inputData }) => {
    console.log("📍 [Step: transform-output] Starting transformation...");
    const property = inputData.rawProperty;
    const rawFormattedText = inputData.formattedText;

    // Parse requirements and pets
    let requisitos = "No especificado";
    let mascotas = "No especificado";

    const reqMatch = rawFormattedText.match(
      /Requisitos:\s*([\s\S]*?)(?=\n\s*Mascotas:|$)/i
    );
    if (reqMatch) requisitos = reqMatch[1].trim();

    const petsMatch = rawFormattedText.match(/Mascotas:\s*([\s\S]*)/i);
    if (petsMatch) mascotas = petsMatch[1].trim();

    // Determine operation type
    let operacionTipo = "";
    const ops = property.operations || [];
    const isVenta = ops.some((op: any) => op.operation_type === "Venta");
    const isAlquiler = ops.some((op: any) => op.operation_type === "Alquiler");

    if (isAlquiler) operacionTipo = "ALQUILAR";
    else if (isVenta) operacionTipo = "VENDER";
    else if (ops.length > 0)
      operacionTipo = ops[0].operation_type === "Venta" ? "VENDER" : "ALQUILAR";

    const propiedadInfo =
      property.description || property.description_only || "";
    const address = property.address || "";

    console.log("✅ [Step: transform-output] Completed. Final Operation Type:", operacionTipo);
    
    return {
      propiedadInfo,
      operacionTipo: operacionTipo as "ALQUILAR" | "VENDER" | "",
      address,
      mascotas,
      requisitos,
    } as z.infer<typeof transformOutputOutputSchema>;
  },
});

// Define Workflow
export const propertyWorkflow = createWorkflow({
  id: "property-intelligence-pipeline",
  inputSchema: z.object({
    url: z.string().url(),
  }),
  outputSchema: z.object({
    propiedadInfo: z.string(),
    operacionTipo: z.enum(["ALQUILAR", "VENDER", ""]),
    address: z.string(),
    mascotas: z.string(),
    requisitos: z.string(),
  }),
})
  .then(extractAddressStep)
  .then(tokkoSearchStep)
  .then(extractRequirementsStep)
  .then(transformOutputStep)
  .commit();
