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
  'recovery_queue?select=student_id&limit=1',
  'app_error_logs?select=id,route,error_type,source&limit=1',
  'platform_settings?select=key,value,updated_at&limit=1',
  'device_commands?select=id,device_id,status&limit=1',
  'auth_trusted_devices?select=id,user_id,login_method,session_scope,auth_level&limit=1',
  'library_subscriptions?select=id,plan_type,whatsapp_enabled,ai_call_enabled&limit=1',
  'subscriptions?select=id,plan_type,whatsapp_enabled,ai_call_enabled&limit=1',
  'leads?select=id,last_contacted_at,next_followup_at,demo_scheduled_at,expected_value,source,whatsapp_opt_in,auto_whatsapp_sent&limit=1',
  'contacts?select=id,email&limit=1',
  'partner_notifications?select=id,partner_id,type&limit=1'
];
(async () => {
  for (const pathSuffix of probes) {
    const response = await fetch(`${baseUrl}/rest/v1/${pathSuffix}`, { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' } });
    console.log(pathSuffix + ' => ' + response.status + ' ' + (await response.text()).slice(0, 300));
  }
})().catch((error) => { console.error(error.message || String(error)); process.exit(1); });
