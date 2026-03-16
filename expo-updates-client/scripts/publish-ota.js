#!/usr/bin/env node

/**
 * publish-ota.js — Standalone OTA publish script for Expo clients.
 *
 * Place this file in any Expo project and run it to export the JS bundle,
 * process assets, and upload everything to the Custom OTA Updates server.
 *
 * No dependency on the server repository — only needs the server URL and API key.
 *
 * Usage:
 *   node scripts/publish-ota.js                    # Both platforms
 *   EXPO_PUBLISH_PLATFORMS=ios node scripts/publish-ota.js   # iOS only
 *   EXPO_PUBLISH_PLATFORMS=android node scripts/publish-ota.js
 *
 * Environment variables (can go in .env):
 *   OTA_SERVER_URL         - Required. e.g. https://otaupdates.example.com:3000
 *   OTA_API_KEY            - Required. Bearer token for POST /api/publish
 *   OTA_PRIVATE_KEY_PATH   - Required. Path to the local RSA private key used to sign manifests
 *   EXPO_PUBLISH_PLATFORMS - Optional. "ios", "android", or "ios,android" (default)
 *
 * For multi-variant projects (app.config.js + env variable):
 *   APP_TYPE=openkey node scripts/publish-ota.js
 */

const [major] = process.versions.node.split(".").map(Number);
if (major < 18) {
  console.error(`Error: Node.js >= 18 required (current: ${process.version}).`);
  process.exit(1);
}

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const crypto = require("crypto");

// ─── Resolve project root (walk up from script location to find app.json/app.config.js) ─

function findProjectRoot(startDir) {
  let dir = startDir;
  while (dir !== path.dirname(dir)) {
    if (
      fs.existsSync(path.join(dir, "app.json")) ||
      fs.existsSync(path.join(dir, "app.config.js")) ||
      fs.existsSync(path.join(dir, "app.config.ts"))
    ) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return null;
}

const PROJECT_ROOT = findProjectRoot(__dirname);
if (!PROJECT_ROOT) {
  console.error(
    "Could not find Expo project root (no app.json or app.config.js found).",
  );
  process.exit(1);
}

// ─── Load .env files (lightweight, no external dependencies) ─────────────────

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const val = trimmed
      .slice(eqIndex + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

// Load .env from the client project root
loadEnvFile(path.join(PROJECT_ROOT, ".env"));

// ─── Config ──────────────────────────────────────────────────────────────────

function requiredEnv(name) {
  const val = process.env[name];
  if (!val) {
    console.error(`Error: ${name} environment variable is required.`);
    console.error("Set it in .env or pass it inline.");
    process.exit(1);
  }
  return val;
}

function resolveProjectPath(filePath) {
  return path.isAbsolute(filePath)
    ? filePath
    : path.resolve(PROJECT_ROOT, filePath);
}

function requiredFilePath(name) {
  const configuredPath = requiredEnv(name);
  const resolvedPath = resolveProjectPath(configuredPath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(
      `Error: ${name} points to a file that does not exist: ${resolvedPath}`,
    );
    process.exit(1);
  }
  return resolvedPath;
}

const SERVER_URL = requiredEnv("OTA_SERVER_URL");
const API_KEY = requiredEnv("OTA_API_KEY");
const PRIVATE_KEY_PATH = requiredFilePath("OTA_PRIVATE_KEY_PATH");
const CERTIFICATE_PATH = path.join(
  PROJECT_ROOT,
  "code-signing",
  "certificate.pem",
);
const ASSETS_BASE_URL = `${SERVER_URL}/api/assets`;

if (!fs.existsSync(CERTIFICATE_PATH)) {
  console.error(
    `Error: certificate.pem not found at ${CERTIFICATE_PATH}. Local signature verification requires the public certificate.`,
  );
  process.exit(1);
}

// ─── MIME map ────────────────────────────────────────────────────────────────

const MIME_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hashAsset(buffer) {
  const sha256 = crypto
    .createHash("sha256")
    .update(buffer)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const md5 = crypto.createHash("md5").update(buffer).digest("hex");
  return { hash: sha256, key: md5 };
}

function processAsset(buffer, ext, contentType, isLaunchAsset) {
  const { hash, key } = hashAsset(buffer);
  const suffix = isLaunchAsset ? "bundle" : ext;
  const filename = `${key}.${suffix}`;

  return {
    hash,
    key,
    fileExtension: `.${suffix}`,
    contentType,
    url: `${ASSETS_BASE_URL}?asset=${filename}`,
    filename,
    data: buffer.toString("base64"),
  };
}

function getExpoConfig() {
  try {
    const { getConfig } = require("@expo/config");
    return getConfig(PROJECT_ROOT, {
      skipSDKVersionRequirement: true,
      isPublicConfig: true,
    }).exp;
  } catch {
    // Fallback: read app.json directly
    const appJsonPath = path.join(PROJECT_ROOT, "app.json");
    if (!fs.existsSync(appJsonPath)) {
      console.error("No app.json found and @expo/config is not available.");
      process.exit(1);
    }
    console.warn(
      "@expo/config not available, falling back to app.json (dynamic config will not be resolved).",
    );
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf8"));
    return appJson.expo || appJson;
  }
}

function parsePlatforms() {
  const raw = (process.env.EXPO_PUBLISH_PLATFORMS || "ios,android").split(",");
  return raw
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p === "ios" || p === "android");
}

function toUUID(hex) {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function signManifest(manifestString, privateKey) {
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(manifestString, "utf8");
  signer.end();
  return signer.sign(privateKey, "base64");
}

function verifyManifestSignature(manifestString, signature, certificate) {
  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(manifestString, "utf8");
  verifier.end();
  return verifier.verify(certificate, signature, "base64");
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const expoConfig = getExpoConfig();
  const runtimeVersion = expoConfig.runtimeVersion;
  if (!runtimeVersion) {
    console.error(
      "runtimeVersion not found in resolved Expo config (app.json / app.config.js).",
    );
    process.exit(1);
  }

  const platforms = parsePlatforms();
  const distDir = path.join(PROJECT_ROOT, "dist");
  const privateKey = fs.readFileSync(PRIVATE_KEY_PATH, "utf8");
  const certificate = fs.readFileSync(CERTIFICATE_PATH, "utf8");

  console.log(
    `Runtime: ${runtimeVersion} | Platforms: ${platforms.join(", ")} | Server: ${SERVER_URL}`,
  );

  for (const platform of platforms) {
    // 1. Export
    console.log(`\n── ${platform} ──`);
    execSync(`npx expo export --platform ${platform}`, {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
    });

    // 2. Read metadata
    const metadata = JSON.parse(
      fs.readFileSync(path.join(distDir, "metadata.json"), "utf8"),
    );
    const platMeta = metadata.fileMetadata[platform];
    if (!platMeta) {
      console.log(`Skipping ${platform} (no metadata)`);
      continue;
    }

    // 3. Process assets
    const bundleBuffer = fs.readFileSync(path.join(distDir, platMeta.bundle));
    const bundle = processAsset(
      bundleBuffer,
      "bundle",
      "application/javascript",
      true,
    );

    const assets = platMeta.assets.map((a) => {
      const buf = fs.readFileSync(path.join(distDir, a.path));
      return processAsset(
        buf,
        a.ext,
        MIME_TYPES[a.ext] || "application/octet-stream",
        false,
      );
    });

    const allAssets = [bundle, ...assets];

    // 4. Build manifest
    const updateId = toUUID(
      crypto.createHash("sha256").update(bundleBuffer).digest("hex"),
    );

    const toManifestAsset = ({
      hash,
      key,
      fileExtension,
      contentType,
      url,
    }) => ({
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

    const manifestString = JSON.stringify(manifest);
    const signature = signManifest(manifestString, privateKey);

    if (!verifyManifestSignature(manifestString, signature, certificate)) {
      console.error(
        `Error: local signature verification failed for ${platform}. OTA_PRIVATE_KEY_PATH does not match code-signing/certificate.pem.`,
      );
      process.exit(1);
    }

    // 5. Upload
    const payload = JSON.stringify({
      runtimeVersion,
      platform,
      manifest,
      signature,
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
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: payload,
    });

    const result = await res.json();
    if (!res.ok) {
      console.error(`Error:`, result.error || result);
      process.exit(1);
    }
    console.log(
      `✓ ${platform}: ${result.updateId} (${result.assetsWritten} assets)`,
    );
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
