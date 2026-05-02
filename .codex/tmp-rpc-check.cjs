const fs = require('fs');
const path = require('path');
const envText = fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8');
const env = Object.fromEntries(envText.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#') && line.includes('=')).map((line) => {
  const index = line.indexOf('=');
  return [line.slice(0, index), line.slice(index + 1)];
}));
(async () => {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/get_schema_entity_status`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ p_entities: ['recovery_queue', 'payments', 'students'] }),
  });
  const text = await response.text();
  console.log(response.status + ' ' + text.slice(0, 400));
})().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
