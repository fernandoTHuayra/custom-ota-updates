const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

async function initDb() {
  const db = await open({
    filename: path.resolve(__dirname, '..', 'updates.db'),
    driver: sqlite3.Database,
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS updates (
      id TEXT PRIMARY KEY,
      runtime_version TEXT NOT NULL,
      platform TEXT,
      created_at TEXT NOT NULL,
      manifest TEXT NOT NULL,
      signature TEXT
    );

    CREATE TABLE IF NOT EXISTS assets (
      key TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      content_type TEXT
    );

    CREATE TABLE IF NOT EXISTS update_assets (
      update_id TEXT,
      asset_key TEXT,
      PRIMARY KEY (update_id, asset_key),
      FOREIGN KEY(update_id) REFERENCES updates(id),
      FOREIGN KEY(asset_key) REFERENCES assets(key)
    );
  `);

  const columns = await db.all('PRAGMA table_info(updates)');
  if (!columns.some((column) => column.name === 'signature')) {
    await db.exec('ALTER TABLE updates ADD COLUMN signature TEXT');
  }
  if (!columns.some((column) => column.name === 'platform')) {
    await db.exec('ALTER TABLE updates ADD COLUMN platform TEXT');
  }

  await db.exec(
    'CREATE INDEX IF NOT EXISTS idx_updates_runtime_platform_created_at ON updates(runtime_version, platform, created_at DESC)',
  );

  await db.exec(`
    DELETE FROM update_assets
    WHERE update_id IN (
      SELECT id
      FROM updates
      WHERE signature IS NULL
        OR platform IS NULL
        OR platform NOT IN ('ios', 'android')
    );

    DELETE FROM updates
    WHERE signature IS NULL
       OR platform IS NULL
       OR platform NOT IN ('ios', 'android');

    DELETE FROM assets
    WHERE key NOT IN (SELECT asset_key FROM update_assets);
  `);

  console.log('Database initialized successfully!');
}

initDb().catch(console.error);
