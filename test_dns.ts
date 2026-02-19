import dns from 'dns';
import util from 'util';

const lookup = util.promisify(dns.lookup);

const hosts = [
  'aws-1-us-east-1.pooler.supabase.com',
  'aws-0-us-east-1.pooler.supabase.com',
  'db.xqnjsdbelpqqpvzkxlvf.supabase.co',
];

(async () => {
  for (const host of hosts) {
    try {
      const { address } = await lookup(host);
      console.log(`✅ ${host} resolved to ${address}`);
    } catch (err: any) {
      console.error(`❌ ${host} failed: ${err.message}`);
    }
  }
})();
