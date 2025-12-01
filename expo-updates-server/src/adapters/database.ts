import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import path from 'path';

export interface Update {
    id: string;
    runtime_version: string;
    created_at: string;
    manifest: any;
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
    private dbPromise: Promise<Database>;

    constructor() {
        this.dbPromise = open({
            filename: path.resolve(process.cwd(), 'updates.db'),
            driver: sqlite3.Database,
        });
    }

    async getLatestUpdate(runtimeVersion: string): Promise<Update | null> {
        const db = await this.dbPromise;
        const update = await db.get<Update>(
            'SELECT * FROM updates WHERE runtime_version = ? ORDER BY created_at DESC LIMIT 1',
            runtimeVersion
        );
        if (update) {
            update.manifest = JSON.parse(update.manifest as any);
        }
        return update || null;
    }

    async insertUpdate(update: Update): Promise<void> {
        const db = await this.dbPromise;
        await db.run(
            'INSERT INTO updates (id, runtime_version, created_at, manifest) VALUES (?, ?, ?, ?)',
            update.id,
            update.runtime_version,
            update.created_at,
            JSON.stringify(update.manifest)
        );
    }

    async insertAsset(asset: Asset): Promise<void> {
        const db = await this.dbPromise;
        await db.run(
            'INSERT OR IGNORE INTO assets (key, url, content_type) VALUES (?, ?, ?)',
            asset.key,
            asset.url,
            asset.content_type
        );
    }

    async insertUpdateAsset(updateId: string, assetKey: string): Promise<void> {
        const db = await this.dbPromise;
        await db.run(
            'INSERT INTO update_assets (update_id, asset_key) VALUES (?, ?)',
            updateId,
            assetKey
        );
    }

    async getAssetsForUpdate(updateId: string): Promise<Asset[]> {
        const db = await this.dbPromise;
        return db.all<Asset[]>(
            `SELECT a.* FROM assets a
       JOIN update_assets ua ON a.key = ua.asset_key
       WHERE ua.update_id = ?`,
            updateId
        );
    }
}

export const dbAdapter = new SQLiteDatabaseAdapter();
