import 'dotenv/config';
import pg from 'pg';

const configuredSupabaseValue = process.env.SUPABASE_URL?.trim() || '';
const databaseUrl = process.env.DATABASE_URL?.trim() || (configuredSupabaseValue.startsWith('postgresql://') || configuredSupabaseValue.startsWith('postgres://') ? configuredSupabaseValue : '');
if (!databaseUrl) {
  console.error('DATABASE_URL (or a PostgreSQL SUPABASE_URL value) is not configured.');
  process.exit(2);
}

const pool = new pg.Pool({
  connectionString: databaseUrl,
  max: 1,
  connectionTimeoutMillis: 8_000,
  ssl: databaseUrl.includes('supabase.com') ? { rejectUnauthorized: false } : undefined
});

try {
  const result = await pool.query('select current_database() as database, current_schema() as schema, now() as server_time');
  console.log(JSON.stringify({ ok: true, database: result.rows[0]?.database, schema: result.rows[0]?.schema, serverTime: result.rows[0]?.server_time }));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.code || 'connection_failed', message: error.message }));
  process.exitCode = 1;
} finally {
  await pool.end();
}
