const fs = require('fs');
const path = require('path');
const envText = fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8');
const env = Object.fromEntries(envText.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#') && line.includes('=')).map((line) => {
  const index = line.indexOf('=');
  return [line.slice(0, index), line.slice(index + 1)];
}));
const baseUrl = env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
(async () => {
  for (const pathSuffix of ['recovery_queue?select=student_id&limit=1','subscriptions?select=*&limit=1','library_subscriptions?select=id,plan_type,whatsapp_enabled,ai_call_enabled&limit=1']) {
    const response = await fetch(`${baseUrl}/rest/v1/${pathSuffix}`, { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' } });
    console.log(pathSuffix + ' => ' + response.status + ' ' + (await response.text()).slice(0, 300));
  }
})().catch((error) => { console.error(error.message || String(error)); process.exit(1); });
