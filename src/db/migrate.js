import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { query, pool } from "./pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "../../migrations");

await query(`CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
const files = (await fs.readdir(migrationsDir)).filter(f => f.endsWith(".sql")).sort();
for (const file of files) {
  const exists = await query("SELECT 1 FROM schema_migrations WHERE version = $1", [file]);
  if (exists.rowCount) continue;
  const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("INSERT INTO schema_migrations(version) VALUES($1)", [file]);
    await client.query("COMMIT");
    console.log(`Applied migration ${file}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
await pool.end();
