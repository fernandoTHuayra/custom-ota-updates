#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');

const DB_PATH = path.resolve(process.cwd(), 'updates.db');
const ASSETS_DIR = path.resolve(process.cwd(), 'public', 'updates', 'assets');

async function ensureSchema(db) {
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
}

function removeDirectoryContents(targetDir) {
  if (!fs.existsSync(targetDir)) {
    return [];
  }

  const deletedEntries = [];
  for (const entry of fs.readdirSync(targetDir)) {
    const entryPath = path.join(targetDir, entry);
    fs.rmSync(entryPath, { recursive: true, force: true });
    deletedEntries.push(entry);
  }

  return deletedEntries;
}

async function main() {
  const db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database,
  });

  try {
    await ensureSchema(db);
    await db.exec('BEGIN IMMEDIATE');
    try {
      await db.exec(`
        DELETE FROM update_assets;
        DELETE FROM updates;
        DELETE FROM assets;
      `);
      await db.exec('COMMIT');
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    await db.close();
  }

  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  const deletedAssetFiles = removeDirectoryContents(ASSETS_DIR);

  console.log(
    JSON.stringify(
      {
        message: 'OTA storage reset completed.',
        dbPath: DB_PATH,
        assetsDir: ASSETS_DIR,
        deletedAssetFiles,
      },
      null,
      2,
    ),
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Failed to reset OTA storage:', error);
    process.exit(1);
  });
}
