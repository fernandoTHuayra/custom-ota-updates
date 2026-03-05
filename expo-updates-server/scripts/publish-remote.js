/**
 * publish-remote.js
 *
 * Runs locally. Exports the Expo client bundle, processes assets,
 * and uploads everything to the remote OTA server via POST /api/publish.
 *
 * Usage:
 *   PUBLISH_API_KEY=<key> yarn publish-remote
 *   PUBLISH_API_KEY=<key> yarn publish-remote:ios
 *   PUBLISH_API_KEY=<key> yarn publish-remote:android
 *
 * Environment variables:
 *   PUBLISH_SERVER_URL     - Required. e.g. https://otaupdates.huayra.com.ar:3000
 *   PUBLISH_API_KEY        - Required.
 *   EXPO_PUBLISH_PLATFORMS - Optional. "ios", "android", or "ios,android" (default).
 *   CLIENT_DIR             - Optional. Path to expo-updates-client (default: ../expo-updates-client).
 */

const [major] = process.versions.node.split('.').map(Number);
if (major < 18) {
  console.error(`Error: Node.js >= 18 required (current: ${process.version}).`);
  process.exit(1);
}

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

// ─── Load .env files (lightweight, no dependencies) ──────────────────────────

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const val = trimmed.slice(eqIndex + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

const serverDir = path.resolve(__dirname, '..');
// .env.local takes precedence, then .env
loadEnvFile(path.join(serverDir, '.env.local'));
loadEnvFile(path.join(serverDir, '.env'));

// ─── Config ───────────────────────────────────────────────────────────────────

const SERVER_URL = requiredEnv('PUBLISH_SERVER_URL');
const API_KEY = requiredEnv('PUBLISH_API_KEY');

const clientDir = path.resolve(
  process.env.CLIENT_DIR || path.join(serverDir, '..', 'expo-updates-client'),
);
const ASSETS_BASE_URL = `${SERVER_URL}/updates/assets`;

if (!fs.existsSync(clientDir)) {
  console.error(`Client directory not found: ${clientDir}`);
  console.error('Set CLIENT_DIR to the correct path.');
  process.exit(1);
}

// ─── MIME map ─────────────────────────────────────────────────────────────────

const MIME_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function requiredEnv(name) {
  const val = process.env[name];
  if (!val) {
    console.error(`Error: ${name} environment variable is required.`);
    process.exit(1);
  }
  return val;
}

function hashAsset(buffer) {
  const sha256 = crypto
    .createHash('sha256')
    .update(buffer)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const md5 = crypto.createHash('md5').update(buffer).digest('hex');
  return { hash: sha256, key: md5 };
}

function processAsset(buffer, ext, contentType, isLaunchAsset) {
  const { hash, key } = hashAsset(buffer);
  const suffix = isLaunchAsset ? 'bundle' : ext;
  const filename = `${key}.${suffix}`;

  return {
    hash,
    key,
    fileExtension: `.${suffix}`,
    contentType,
    url: `${ASSETS_BASE_URL}/${filename}`,
    filename,
    data: buffer.toString('base64'),
  };
}

function readAppConfig() {
  const appJson = JSON.parse(fs.readFileSync(path.join(clientDir, 'app.json'), 'utf8'));
  return appJson.expo || appJson;
}

function getExpoConfig() {
  try {
    const { getConfig } = require('@expo/config');
    return getConfig(clientDir, { skipSDKVersionRequirement: true, isPublicConfig: true }).exp;
  } catch {
    console.warn('@expo/config not available, falling back to app.json.');
    return readAppConfig();
  }
}

function parsePlatforms() {
  const raw = (process.env.EXPO_PUBLISH_PLATFORMS || 'ios,android').split(',');
  return raw.map((p) => p.trim().toLowerCase()).filter((p) => p === 'ios' || p === 'android');
}

function toUUID(hex) {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const config = readAppConfig();
  const runtimeVersion = config.runtimeVersion;
  if (!runtimeVersion) {
    console.error('runtimeVersion not found in app.json');
    process.exit(1);
  }

  const expoConfig = getExpoConfig();
  const platforms = parsePlatforms();
  const distDir = path.join(clientDir, 'dist');

  console.log(
    `Runtime: ${runtimeVersion} | Platforms: ${platforms.join(', ')} | Server: ${SERVER_URL}`,
  );

  for (const platform of platforms) {
    // 1. Export
    console.log(`\n── ${platform} ──`);
    execSync(`npx --no-install expo export --platform ${platform}`, {
      cwd: clientDir,
      stdio: 'inherit',
    });

    // 2. Read metadata
    const metadata = JSON.parse(fs.readFileSync(path.join(distDir, 'metadata.json'), 'utf8'));
    const platMeta = metadata.fileMetadata[platform];
    if (!platMeta) {
      console.log(`Skipping ${platform} (no metadata)`);
      continue;
    }

    // 3. Process assets
    const bundleBuffer = fs.readFileSync(path.join(distDir, platMeta.bundle));
    const bundle = processAsset(bundleBuffer, 'bundle', 'application/javascript', true);

    const assets = platMeta.assets.map((a) => {
      const buf = fs.readFileSync(path.join(distDir, a.path));
      return processAsset(buf, a.ext, MIME_TYPES[a.ext] || 'application/octet-stream', false);
    });

    const allAssets = [bundle, ...assets];

    // 4. Build manifest
    const updateId = toUUID(crypto.createHash('sha256').update(bundleBuffer).digest('hex'));

    const toManifestAsset = ({ hash, key, fileExtension, contentType, url }) => ({
      hash,
      key,
      fileExtension,
      contentType,
      url,
    });

    const manifest = {
      id: updateId,
      createdAt: new Date().toISOString(),
      runtimeVersion,
      assets: assets.map(toManifestAsset),
      launchAsset: toManifestAsset(bundle),
      metadata: {},
      extra: { expoClient: expoConfig },
    };

    // 5. Upload
    const payload = JSON.stringify({
      runtimeVersion,
      manifest,
      assets: allAssets.map(({ filename, key, contentType, url, data }) => ({
        filename,
        key,
        contentType,
        url,
        data,
      })),
    });

    const sizeMB = (Buffer.byteLength(payload) / (1024 * 1024)).toFixed(2);
    console.log(`Uploading ${updateId} (${sizeMB} MB)...`);

    const res = await fetch(`${SERVER_URL}/api/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body: payload,
    });

    const result = await res.json();
    if (!res.ok) {
      console.error(`Error:`, result.error || result);
      process.exit(1);
    }
    console.log(`✓ ${platform}: ${result.updateId} (${result.assetsWritten} assets)`);
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
