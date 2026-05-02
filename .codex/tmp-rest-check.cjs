const fs = require('fs');
const path = require('path');
const envText = fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8');
const env = Object.fromEntries(envText.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#') && line.includes('=')).map((line) => {
  const index = line.indexOf('=');
  return [line.slice(0, index), line.slice(index + 1)];
}));
const baseUrl = env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const entities = ['recovery_queue','payments','students','app_error_logs','platform_settings'];
(async () => {
  const results = {};
  for (const entity of entities) {
    const response = await fetch(`${baseUrl}/rest/v1/${entity}?select=*&limit=1`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
      },
    });
    const text = await response.text();
    results[entity] = {
      status: response.status,
      ok: response.ok,
      body: text.slice(0, 300),
    };
  }
  console.log(JSON.stringify(results, null, 2));
})().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
