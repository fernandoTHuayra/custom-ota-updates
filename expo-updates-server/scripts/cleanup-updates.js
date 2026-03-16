#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');

const DEFAULT_KEEP_LATEST = 2;
const DEFAULT_DB_PATH = path.resolve(process.cwd(), 'updates.db');
const DEFAULT_ASSETS_DIR = path.resolve(process.cwd(), 'public', 'updates', 'assets');
const DEFAULT_LOCK_PATH = path.resolve(process.cwd(), '.cleanup-updates.lock');

function parseInteger(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid integer value: ${value}`);
  }

  return parsed;
}

function parseArgs(argv) {
  const args = {
    runtimeVersion: undefined,
    platform: undefined,
    keepLatest: parseInteger(process.env.OTA_CLEANUP_KEEP_LATEST, DEFAULT_KEEP_LATEST),
    dbPath: process.env.OTA_UPDATES_DB_PATH || DEFAULT_DB_PATH,
    assetsDir: process.env.OTA_UPDATES_ASSETS_DIR || DEFAULT_ASSETS_DIR,
    lockPath: process.env.OTA_CLEANUP_LOCK_PATH || DEFAULT_LOCK_PATH,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--runtimeVersion') {
      args.runtimeVersion = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--platform') {
      args.platform = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--keepLatest') {
      args.keepLatest = parseInteger(argv[index + 1], DEFAULT_KEEP_LATEST);
      index += 1;
      continue;
    }

    if (arg === '--dbPath') {
      args.dbPath = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === '--assetsDir') {
      args.assetsDir = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === '--lockPath') {
      args.lockPath = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === '--dry-run') {
      args.dryRun = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (args.keepLatest < 1) {
    throw new Error('keepLatest must be at least 1.');
  }

  if (args.platform !== undefined && args.platform !== 'ios' && args.platform !== 'android') {
    throw new Error('platform must be ios or android.');
  }

  return args;
}

async function ensurePlatformColumn(db) {
  const columns = await db.all('PRAGMA table_info(updates)');
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
}

function parseAssetFilenameFromUrl(assetUrl) {
  if (!assetUrl) {
    return null;
  }

  try {
    const parsedUrl = new URL(assetUrl);
    const assetName = parsedUrl.searchParams.get('asset');
    if (assetName) {
      return path.basename(assetName);
    }
    return path.basename(parsedUrl.pathname);
  } catch {
    const [pathPart, queryString] = assetUrl.split('?');
    if (queryString) {
      const params = new URLSearchParams(queryString);
      const assetName = params.get('asset');
      if (assetName) {
        return path.basename(assetName);
      }
    }
    return path.basename(pathPart);
  }
}

function acquireLock(lockPath) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  let descriptor;
  try {
    descriptor = fs.openSync(lockPath, 'wx');
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      return null;
    }
    throw error;
  }

  fs.writeFileSync(descriptor, `${process.pid}\n`, 'utf8');

  return () => {
    try {
      fs.closeSync(descriptor);
    } catch {}
    try {
      fs.unlinkSync(lockPath);
    } catch {}
  };
}

async function getRetentionGroups(db, runtimeVersion, platform) {
  if (runtimeVersion && platform) {
    return [{ runtimeVersion, platform }];
  }

  if (runtimeVersion) {
    const rows = await db.all(
      `SELECT DISTINCT runtime_version, platform
       FROM updates
       WHERE runtime_version = ?
         AND platform IN ('ios', 'android')
       ORDER BY runtime_version ASC, platform ASC`,
      runtimeVersion,
    );
    return rows.map((row) => ({ runtimeVersion: row.runtime_version, platform: row.platform }));
  }

  const rows = await db.all(
    `SELECT DISTINCT runtime_version, platform
     FROM updates
     WHERE platform IN ('ios', 'android')
     ORDER BY runtime_version ASC, platform ASC`,
  );
  return rows.map((row) => ({ runtimeVersion: row.runtime_version, platform: row.platform }));
}

async function getObsoleteUpdateIds(db, runtimeVersion, platform, keepLatest) {
  const rows = await db.all(
    `SELECT id
     FROM updates
     WHERE runtime_version = ? AND platform = ?
     ORDER BY created_at DESC, id DESC
     LIMIT -1 OFFSET ?`,
    runtimeVersion,
    platform,
    keepLatest,
  );

  return rows.map((row) => row.id);
}

async function getOrphanAssets(db) {
  return db.all(
    `SELECT a.key, a.url
     FROM assets a
     LEFT JOIN update_assets ua ON ua.asset_key = a.key
     WHERE ua.asset_key IS NULL`,
  );
}

async function getOrphanAssetsAfterDeletingUpdates(db, obsoleteUpdateIds) {
  if (obsoleteUpdateIds.length === 0) {
    return getOrphanAssets(db);
  }

  const updatePlaceholders = obsoleteUpdateIds.map(() => '?').join(', ');
  return db.all(
    `SELECT a.key, a.url
     FROM assets a
     WHERE NOT EXISTS (
       SELECT 1
       FROM update_assets ua
       WHERE ua.asset_key = a.key
         AND ua.update_id NOT IN (${updatePlaceholders})
     )`,
    obsoleteUpdateIds,
  );
}

async function getActiveAssetFilenames(db) {
  const rows = await db.all('SELECT url FROM assets');
  return new Set(rows.map((row) => parseAssetFilenameFromUrl(row.url)).filter(Boolean));
}

async function deleteOrphanAssets(db, dryRun, obsoleteUpdateIds = []) {
  const orphanAssets = await getOrphanAssetsAfterDeletingUpdates(db, obsoleteUpdateIds);
  const assetKeys = orphanAssets.map((asset) => asset.key);

  if (!dryRun && assetKeys.length > 0) {
    const assetPlaceholders = assetKeys.map(() => '?').join(', ');
    await db.run(
      `DELETE FROM assets
       WHERE key IN (${assetPlaceholders})`,
      assetKeys,
    );
  }

  return {
    deletedAssetKeys: assetKeys,
    deletedAssetFilenames: orphanAssets
      .map((asset) => parseAssetFilenameFromUrl(asset.url))
      .filter(Boolean),
  };
}

function removeFiles(assetsDir, expectedFiles, dryRun) {
  if (!fs.existsSync(assetsDir)) {
    return [];
  }

  const deletedFiles = [];
  for (const entry of fs.readdirSync(assetsDir)) {
    const filePath = path.join(assetsDir, entry);
    if (!fs.statSync(filePath).isFile()) {
      continue;
    }

    if (expectedFiles.has(entry)) {
      continue;
    }

    deletedFiles.push(entry);
    if (!dryRun) {
      fs.unlinkSync(filePath);
    }
  }

  return deletedFiles;
}

async function cleanupUpdates(options) {
  const db = await open({
    filename: options.dbPath,
    driver: sqlite3.Database,
  });

  try {
    await ensurePlatformColumn(db);

    const retentionGroups = await getRetentionGroups(db, options.runtimeVersion, options.platform);
    const summary = {
      keepLatest: options.keepLatest,
      retentionGroups,
      deletedUpdateIds: [],
      deletedAssetKeys: [],
      deletedFiles: [],
      dryRun: options.dryRun,
    };

    const obsoleteUpdateIdsByGroup = new Map();
    for (const group of retentionGroups) {
      obsoleteUpdateIdsByGroup.set(
        `${group.runtimeVersion}:${group.platform}`,
        await getObsoleteUpdateIds(db, group.runtimeVersion, group.platform, options.keepLatest),
      );
    }

    const obsoleteUpdateIds = Array.from(obsoleteUpdateIdsByGroup.values()).flat();

    if (options.dryRun) {
      summary.deletedUpdateIds = obsoleteUpdateIds;
      const orphanSummary = await deleteOrphanAssets(db, true, obsoleteUpdateIds);
      summary.deletedAssetKeys = orphanSummary.deletedAssetKeys;
    } else {
      await db.exec('BEGIN IMMEDIATE');
      try {
        if (obsoleteUpdateIds.length > 0) {
          const updatePlaceholders = obsoleteUpdateIds.map(() => '?').join(', ');
          await db.run(
            `DELETE FROM update_assets
             WHERE update_id IN (${updatePlaceholders})`,
            obsoleteUpdateIds,
          );

          await db.run(
            `DELETE FROM updates
             WHERE id IN (${updatePlaceholders})`,
            obsoleteUpdateIds,
          );
        }

        const orphanSummary = await deleteOrphanAssets(db, false);
        summary.deletedUpdateIds = obsoleteUpdateIds;
        summary.deletedAssetKeys = orphanSummary.deletedAssetKeys;

        await db.exec('COMMIT');
      } catch (error) {
        await db.exec('ROLLBACK');
        throw error;
      }
    }

    const activeFiles = await getActiveAssetFilenames(db);
    summary.deletedFiles = removeFiles(options.assetsDir, activeFiles, options.dryRun);

    return summary;
  } finally {
    await db.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const releaseLock = acquireLock(options.lockPath);
  if (!releaseLock) {
    console.log('Cleanup skipped because another cleanup job is already running.');
    return;
  }

  try {
    const summary = await cleanupUpdates(options);
    console.log(
      JSON.stringify(
        {
          message: 'OTA cleanup finished.',
          ...summary,
        },
        null,
        2,
      ),
    );
  } finally {
    releaseLock();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('OTA cleanup failed:', error);
    process.exit(1);
  });
}

module.exports = {
  cleanupUpdates,
  getObsoleteUpdateIds,
  parseArgs,
  parseAssetFilenameFromUrl,
};
