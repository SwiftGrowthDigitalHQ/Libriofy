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
  { name: 'recovery_queue', path: 'recovery_queue?select=student_id&limit=1' },
  { name: 'app_error_logs', path: 'app_error_logs?select=id&limit=1' },
  { name: 'platform_settings', path: 'platform_settings?select=key,value&limit=1' },
  { name: 'entry_devices', path: 'entry_devices?select=id,device_id&limit=1' },
  { name: 'library_access_keys', path: 'library_access_keys?select=id,library_id,access_key&limit=1' },
  { name: 'device_setup_attempts', path: 'device_setup_attempts?select=id,library_id,device_id&limit=1' },
  { name: 'device_commands', path: 'device_commands?select=id,device_id,status&limit=1' },
  { name: 'id_card_delivery_jobs', path: 'id_card_delivery_jobs?select=id,student_id,status&limit=1' },
  { name: 'id_card_delivery_logs', path: 'id_card_delivery_logs?select=id,job_id,status&limit=1' },
  { name: 'auth_trusted_devices', path: 'auth_trusted_devices?select=id,user_id,login_method&limit=1' },
  { name: 'login_logs', path: 'login_logs?select=id,status,login_step&limit=1' },
  { name: 'contacts', path: 'contacts?select=id,email&limit=1' },
  { name: 'partner_lead_notes', path: 'partner_lead_notes?select=id,lead_id&limit=1' },
  { name: 'partner_lead_activity', path: 'partner_lead_activity?select=id,lead_id&limit=1' },
  { name: 'partner_notifications', path: 'partner_notifications?select=id,partner_id,type&limit=1' },
  { name: 'partner_referral_clicks', path: 'partner_referral_clicks?select=id,referral_code&limit=1' },
  { name: 'library_subscriptions_columns', path: 'library_subscriptions?select=id,plan_type,whatsapp_enabled,ai_call_enabled&limit=1' },
  { name: 'leads_columns', path: 'leads?select=id,last_contacted_at,next_followup_at,demo_scheduled_at,expected_value,source,whatsapp_opt_in,auto_whatsapp_sent&limit=1' },
  { name: 'subscriptions_view_columns', path: 'subscriptions?select=id,plan_type,whatsapp_enabled,ai_call_enabled&limit=1' },
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
      body: text.slice(0, 240),
    };
  }
  console.log(JSON.stringify(results, null, 2));
})().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
