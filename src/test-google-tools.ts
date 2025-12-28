import { mastra } from "./mastra/index";

async function main() {
  const agent = mastra.getAgent("realEstateAgent");
  if (!agent) {
    console.error("Agent 'realEstateAgent' not found!");
    process.exit(1);
  }

  // Check for placeholder token
  if (process.env.GOOGLE_REFRESH_TOKEN === 'tu_refresh_token') {
    console.warn("⚠️  WARNING: 'GOOGLE_REFRESH_TOKEN' in .env appears to be a placeholder 'tu_refresh_token'.");
    console.warn("   Updates to Gmail and Calendar tools will fail without a valid token.");
    console.warn("   You need to generate a Refresh Token using OAuth2 Playground or similar.");
  }

  console.log("Found Agent:", agent.name);

  // Test 1: Check Emails
  console.log("\n--- TEST 1: Checking Emails ---");
  const emailPrompt = "Lee mis últimos 3 emails y dime de qué tratan.";
  console.log(`Prompt: "${emailPrompt}"`);
  try {
    const res1 = await agent.generate(emailPrompt);
    console.log("Response:", JSON.stringify(res1.text, null, 2));
  } catch (err) {
    console.error("Error executing email test:", err);
  }

  // Test 2: Check Calendar
  console.log("\n--- TEST 2: Checking Calendar ---");
  const calendarPrompt = "¿Qué eventos tengo en el calendario para los próximos 7 días?";
  console.log(`Prompt: "${calendarPrompt}"`);
  try {
    const res2 = await agent.generate(calendarPrompt);
    console.log("Response:", JSON.stringify(res2.text, null, 2));
  } catch (err) {
    console.error("Error executing calendar test:", err);
  }
}

main().catch(console.error);
