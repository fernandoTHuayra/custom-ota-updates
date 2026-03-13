import path from 'path';
import { open, Database } from 'sqlite';
import sqlite3 from 'sqlite3';

export interface Update {
  id: string;
  runtime_version: string;
  created_at: string;
  manifest: any;
  signature: string | null;
}

export interface Asset {
  key: string;
  url: string;
  content_type: string;
}

export interface DatabaseAdapter {
  getLatestUpdate(runtimeVersion: string): Promise<Update | null>;
  insertUpdate(update: Update): Promise<void>;
  insertAsset(asset: Asset): Promise<void>;
  insertUpdateAsset(updateId: string, assetKey: string): Promise<void>;
  getAssetsForUpdate(updateId: string): Promise<Asset[]>;
}

export class SQLiteDatabaseAdapter implements DatabaseAdapter {
  private readonly dbPromise: Promise<Database>;

  constructor() {
    this.dbPromise = open({
      filename: path.resolve(process.cwd(), 'updates.db'),
      driver: sqlite3.Database,
    }).then(async (db: Database) => {
      await this.runMigrations(db);
      return db;
    });
  }

  private async runMigrations(db: Database): Promise<void> {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS updates (
        id TEXT PRIMARY KEY,
        runtime_version TEXT NOT NULL,
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

    const columns: Array<{ name: string }> = await db.all('PRAGMA table_info(updates)');
    if (!columns.some((column) => column.name === 'signature')) {
      await db.exec('ALTER TABLE updates ADD COLUMN signature TEXT');
    }

    await db.exec(`
      DELETE FROM update_assets
      WHERE update_id IN (SELECT id FROM updates WHERE signature IS NULL);

      DELETE FROM updates
      WHERE signature IS NULL;

      DELETE FROM assets
      WHERE key NOT IN (SELECT asset_key FROM update_assets);
    `);
  }

  async getLatestUpdate(runtimeVersion: string): Promise<Update | null> {
    const db = await this.dbPromise;
    const update = await db.get<Update>(
      'SELECT * FROM updates WHERE runtime_version = ? ORDER BY created_at DESC LIMIT 1',
      runtimeVersion,
    );
    if (update) {
      update.manifest = JSON.parse(update.manifest as any);
    }
    return update ?? null;
  }

  async insertUpdate(update: Update): Promise<void> {
    const db = await this.dbPromise;
    await db.run(
      'INSERT OR REPLACE INTO updates (id, runtime_version, created_at, manifest, signature) VALUES (?, ?, ?, ?, ?)',
      update.id,
      update.runtime_version,
      update.created_at,
      JSON.stringify(update.manifest),
      update.signature,
    );
  }

  async insertAsset(asset: Asset): Promise<void> {
    const db = await this.dbPromise;
    await db.run(
      'INSERT OR IGNORE INTO assets (key, url, content_type) VALUES (?, ?, ?)',
      asset.key,
      asset.url,
      asset.content_type,
    );
  }

  async insertUpdateAsset(updateId: string, assetKey: string): Promise<void> {
    const db = await this.dbPromise;
    await db.run(
      'INSERT OR IGNORE INTO update_assets (update_id, asset_key) VALUES (?, ?)',
      updateId,
      assetKey,
    );
  }

  async getAssetsForUpdate(updateId: string): Promise<Asset[]> {
    const db = await this.dbPromise;
    return await db.all<Asset[]>(
      `SELECT a.* FROM assets a
       JOIN update_assets ua ON a.key = ua.asset_key
       WHERE ua.update_id = ?`,
      updateId,
    );
  }
}

export const dbAdapter = new SQLiteDatabaseAdapter();
