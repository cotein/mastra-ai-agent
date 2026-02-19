import { Client } from 'pg';
import 'dotenv/config';

async function testConnection(connectionString: string, label: string) {
  console.log(`Testing ${label}: ${connectionString.replace(/:[^:@]+@/, ':***@')}`);
  const client = new Client({ connectionString });
  try {
    await client.connect();
    console.log(`✅ Success: ${label}`);
    await client.end();
  } catch (err: any) {
    console.error(`❌ Failed ${label}: ${err.message}`);
    if (err.code) console.error(`   Code: ${err.code}`);
    if (err.hostname) console.error(`   Hostname: ${err.hostname}`);
  }
}

(async () => {
  const originalUrl = process.env.SUPABASE_POSTGRES_URL!;
  // 1. Original
  await testConnection(originalUrl, "Original URL from .env");

  // 2. Try encoding the password @
  // Assuming password is "1612EmiliaErnestina1806@"
  const fixedPasswordUrl = originalUrl.replace("1612EmiliaErnestina1806@", "1612EmiliaErnestina1806%40");
  await testConnection(fixedPasswordUrl, "Encoded Password URL");

  // 3. Try aws-0 instead of aws-1
  const aws0Url = originalUrl.replace("aws-1-us-east-1", "aws-0-us-east-1");
  await testConnection(aws0Url, "aws-0 Hostname");

  // 4. Try direct connection (no pooler)
  // postgres://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres
  // We need to extract project ref.
  // From .env: SUPABASE_URL=https://xqnjsdbelpqqpvzkxlvf.supabase.co -> ref: xqnjsdbelpqqpvzkxlvf
  // Password: 1612EmiliaErnestina1806@
  const directUrl = `postgresql://postgres:1612EmiliaErnestina1806%40@db.xqnjsdbelpqqpvzkxlvf.supabase.co:5432/postgres`;
  await testConnection(directUrl, "Direct Connection (Regular DB)");
})();
