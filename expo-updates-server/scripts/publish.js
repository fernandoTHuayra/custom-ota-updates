const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const serverDir = path.resolve(__dirname, '..');
const clientDir = path.resolve(serverDir, '../expo-updates-client');
const publicAssetsDir = path.join(serverDir, 'public', 'updates', 'assets');

// Ensure public assets directory exists
if (!fs.existsSync(publicAssetsDir)) {
    fs.mkdirSync(publicAssetsDir, { recursive: true });
}

async function publish() {
    // 1. Read app.json for runtime version
    const clientAppJsonPath = path.join(clientDir, 'app.json');
    let runtimeVersion;
    try {
        const clientAppJson = require(clientAppJsonPath);
        runtimeVersion = clientAppJson.expo.runtimeVersion;
    } catch (error) {
        console.error(`Error reading app.json at ${clientAppJsonPath}:`, error);
        process.exit(1);
    }

    if (!runtimeVersion) {
        console.error('Error: runtimeVersion not found in app.json');
        process.exit(1);
    }

    // 2. Export the client app
    console.log('Running expo export in client...');
    execSync('npx expo export', { cwd: clientDir, stdio: 'inherit' });

    const distDir = path.join(clientDir, 'dist');
    const metadataPath = path.join(distDir, 'metadata.json');
    if (!fs.existsSync(metadataPath)) {
        console.error('Error: metadata.json not found in dist directory. Did expo export fail?');
        process.exit(1);
    }

    const metadataJson = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    const db = await open({
        filename: path.join(serverDir, 'updates.db'),
        driver: sqlite3.Database
    });

    // 3. Process updates for each platform
    const platforms = ['ios', 'android'];
    for (const platform of platforms) {
        if (!metadataJson.fileMetadata[platform]) {
            console.log(`Skipping ${platform} (no metadata found)`);
            continue;
        }

        console.log(`Processing update for ${platform}...`);
        const platformMetadata = metadataJson.fileMetadata[platform];
        const assets = [];

        // Process Bundle (Launch Asset)
        const bundlePath = path.join(distDir, platformMetadata.bundle);
        const bundleBuffer = fs.readFileSync(bundlePath);
        const bundleAsset = await processAsset(bundleBuffer, 'bundle', 'application/javascript', true);

        // Process Assets
        for (const asset of platformMetadata.assets) {
            const assetPath = path.join(distDir, asset.path);
            const assetBuffer = fs.readFileSync(assetPath);
            // Guess mime type based on extension (simple version)
            const ext = asset.ext;
            let contentType = 'application/octet-stream';
            if (ext === 'png') contentType = 'image/png';
            if (ext === 'jpg' || ext === 'jpeg') contentType = 'image/jpeg';
            if (ext === 'ttf') contentType = 'font/ttf';

            const processedAsset = await processAsset(assetBuffer, ext, contentType, false);
            assets.push(processedAsset);
        }

        // Generate Update ID (UUID from SHA256 of metadata + platform specific stuff? 
        // Original logic used hash of metadata.json. Let's create a unique ID based on the bundle hash + runtime version + time)
        const updateId = convertSHA256HashToUUID(crypto.createHash('sha256').update(bundleBuffer).digest('hex'));
        const createdAt = new Date().toISOString();

        // Get Expo Config
        const expoConfigScript = path.join(serverDir, 'scripts', 'exportClientExpoConfig.js');
        const expoConfigOutput = execSync(`node "${expoConfigScript}"`, { cwd: serverDir }).toString();
        const expoConfig = JSON.parse(expoConfigOutput);

        // Construct Manifest
        const manifest = {
            id: updateId,
            createdAt,
            runtimeVersion,
            assets: assets,
            launchAsset: bundleAsset,
            metadata: {},
            extra: {
                expoClient: expoConfig,
            },
        };

        // Insert into DB
        console.log(`Inserting update ${updateId} into database...`);

        // Insert Assets into DB
        await db.run(
            'INSERT OR IGNORE INTO assets (key, url, content_type) VALUES (?, ?, ?)',
            bundleAsset.key, bundleAsset.url, bundleAsset.contentType
        );

        for (const asset of assets) {
            await db.run(
                'INSERT OR IGNORE INTO assets (key, url, content_type) VALUES (?, ?, ?)',
                asset.key, asset.url, asset.contentType
            );
        }

        // Insert Update
        await db.run(
            'INSERT INTO updates (id, runtime_version, created_at, manifest) VALUES (?, ?, ?, ?)',
            updateId, runtimeVersion, createdAt, JSON.stringify(manifest)
        );

        // Link Update to Assets
        await db.run('INSERT INTO update_assets (update_id, asset_key) VALUES (?, ?)', updateId, bundleAsset.key);
        for (const asset of assets) {
            await db.run('INSERT INTO update_assets (update_id, asset_key) VALUES (?, ?)', updateId, asset.key);
        }
    }

    console.log('Update published successfully!');
}

// --- Storage Abstraction ---

async function processAsset(buffer, ext, contentType, isLaunchAsset) {
    const hash = getBase64URLEncoding(crypto.createHash('sha256').update(buffer).digest('base64'));
    const key = crypto.createHash('md5').update(buffer).digest('hex');
    const filename = key + (ext ? `.${ext}` : '');

    // Upload the asset (Local or Cloud)
    const url = await uploadAsset(filename, buffer, contentType);

    return {
        hash,
        key,
        fileExtension: ext ? `.${ext}` : '',
        contentType,
        url
    };
}

/**
 * Uploads an asset to the configured storage provider.
 * Currently implements 'local' storage.
 * To migrate to R2/S3, modify this function to use AWS SDK.
 */
async function uploadAsset(filename, buffer, contentType) {
    // Future: if (process.env.STORAGE_PROVIDER === 's3') { return uploadToS3(...) }

    // Local Storage Implementation
    const destPath = path.join(publicAssetsDir, filename);
    fs.writeFileSync(destPath, buffer);

    // Construct public URL
    // In production (VPS), this should be your domain: https://updates.tudominio.com/updates/assets
    const baseUrl = process.env.ASSETS_BASE_URL || 'http://10.0.2.2:3000/updates/assets';
    return `${baseUrl}/${filename}`;
}

// ---------------------------

function getBase64URLEncoding(base64EncodedString) {
    return base64EncodedString.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function convertSHA256HashToUUID(value) {
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

publish().catch(error => {
    console.error(error);
    process.exit(1);
});
