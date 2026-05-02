const fs = require('fs');
const path = require('path');
const envText = fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8');
const env = Object.fromEntries(envText.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#') && line.includes('=')).map((line) => {
  const index = line.indexOf('=');
  return [line.slice(0, index), line.slice(index + 1)];
}));
const baseUrl = env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const probes = [
  { name: 'library_access_keys_all', path: 'library_access_keys?select=*&limit=1' },
  { name: 'device_setup_attempts_all', path: 'device_setup_attempts?select=*&limit=1' },
  { name: 'entry_devices_all', path: 'entry_devices?select=*&limit=1' }
];
(async () => {
  const results = {};
  for (const probe of probes) {
    const response = await fetch(`${baseUrl}/rest/v1/${probe.path}`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
      },
    });
    const text = await response.text();
    results[probe.name] = {
      status: response.status,
      ok: response.ok,
      body: text.slice(0, 1200),
    };
  }
  console.log(JSON.stringify(results, null, 2));
})().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
