const fs = require('fs');
const { Client } = require('pg');
(async () => {
  const connectionString = fs.readFileSync('supabase/.temp/pooler-url', 'utf8').trim();
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const result = await client.query(`
    select
      to_regclass('public.recovery_queue')::text as recovery_queue,
      to_regclass('public.payments')::text as payments,
      to_regclass('public.students')::text as students,
      to_regclass('public.app_error_logs')::text as app_error_logs,
      to_regclass('public.platform_settings')::text as platform_settings,
      (select count(*)::int from supabase_migrations.schema_migrations) as applied_migration_count
  `);
  console.log(JSON.stringify(result.rows[0]));
  await client.end();
})().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
