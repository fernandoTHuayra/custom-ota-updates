import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { NextApiRequest, NextApiResponse } from 'next';

import { getCertificateAsync, verifyRSASHA256 } from '../../common/helpers';
import { dbAdapter } from '../../src/adapters/database';

const PUBLISH_API_KEY = process.env.PUBLISH_API_KEY;
const PUBLIC_ASSETS_DIR = path.join(process.cwd(), 'public', 'updates', 'assets');
const CLEANUP_SCRIPT_PATH = path.join(process.cwd(), 'scripts', 'cleanup-updates.js');
const CLEANUP_ENABLED = process.env.OTA_CLEANUP_ENABLED !== 'false';

function triggerCleanupJob(runtimeVersion: string, platform: 'ios' | 'android') {
  if (!CLEANUP_ENABLED) {
    return;
  }

  if (!fs.existsSync(CLEANUP_SCRIPT_PATH)) {
    console.warn(
      `Cleanup script not found at ${CLEANUP_SCRIPT_PATH}. Skipping post-publish cleanup.`,
    );
    return;
  }

  try {
    const child = spawn(
      process.execPath,
      [CLEANUP_SCRIPT_PATH, '--runtimeVersion', runtimeVersion, '--platform', platform],
      {
        cwd: process.cwd(),
        detached: true,
        stdio: 'ignore',
        env: process.env,
      },
    );
    child.unref();
  } catch (error) {
    console.error('Failed to start OTA cleanup job:', error);
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
};

interface AssetPayload {
  filename: string;
  key: string;
  contentType: string;
  url: string;
  data: string; // base64
}

interface PublishPayload {
  runtimeVersion: string;
  platform: 'ios' | 'android';
  signature: string;
  manifest: {
    id: string;
    createdAt: string;
    runtimeVersion: string;
    assets: any[];
    launchAsset: any;
    metadata: any;
    extra: any;
  };
  assets: AssetPayload[];
}

export default async function publishEndpoint(req: NextApiRequest, res: NextApiResponse) {
  // Only allow POST
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.json({ error: 'Expected POST.' });
    return;
  }

  // Validate API key
  if (!PUBLISH_API_KEY) {
    console.error('PUBLISH_API_KEY environment variable is not set. Refusing publish requests.');
    res.statusCode = 500;
    res.json({ error: 'Server is not configured for publishing. Set PUBLISH_API_KEY.' });
    return;
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || authHeader !== `Bearer ${PUBLISH_API_KEY}`) {
    res.statusCode = 401;
    res.json({ error: 'Unauthorized. Invalid or missing API key.' });
    return;
  }

  try {
    const body: PublishPayload = req.body;

    // Validate required fields
    if (
      !body.runtimeVersion ||
      !body.platform ||
      !body.manifest ||
      !body.assets ||
      !body.signature
    ) {
      res.statusCode = 400;
      res.json({
        error: 'Missing required fields: runtimeVersion, platform, manifest, assets, signature.',
      });
      return;
    }

    if (body.platform !== 'ios' && body.platform !== 'android') {
      res.statusCode = 400;
      res.json({ error: 'Invalid platform. Expected ios or android.' });
      return;
    }

    if (!body.manifest.id || !body.manifest.createdAt) {
      res.statusCode = 400;
      res.json({ error: 'Manifest must include id and createdAt.' });
      return;
    }

    const certificate = await getCertificateAsync();
    if (!certificate) {
      console.error(
        'certificate.pem is missing. Refusing publish request because manifest signatures cannot be verified.',
      );
      res.statusCode = 500;
      res.json({
        error: 'Server is missing certificate.pem required to verify publish signatures.',
      });
      return;
    }

    const isValidSignature = verifyRSASHA256(
      JSON.stringify(body.manifest),
      body.signature,
      certificate,
    );

    if (!isValidSignature) {
      res.statusCode = 400;
      res.json({ error: 'Invalid manifest signature' });
      return;
    }

    // Ensure public assets directory exists
    if (!fs.existsSync(PUBLIC_ASSETS_DIR)) {
      fs.mkdirSync(PUBLIC_ASSETS_DIR, { recursive: true });
    }

    // Write asset files to disk
    const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
    const writtenAssets: string[] = [];
    for (const asset of body.assets) {
      if (!asset.filename || !asset.data) {
        res.statusCode = 400;
        res.json({ error: `Asset missing filename or data.` });
        return;
      }

      if (typeof asset.data !== 'string' || !BASE64_RE.test(asset.data)) {
        res.statusCode = 400;
        res.json({ error: `Asset "${asset.filename}" contains invalid base64 data.` });
        return;
      }

      const destPath = path.join(PUBLIC_ASSETS_DIR, asset.filename);
      const buffer = Buffer.from(asset.data, 'base64');

      if (buffer.length === 0 && asset.data.length > 0) {
        res.statusCode = 400;
        res.json({ error: `Asset "${asset.filename}" produced empty buffer from base64 data.` });
        return;
      }

      fs.writeFileSync(destPath, buffer);
      writtenAssets.push(asset.filename);
    }

    // Insert assets into database concurrently
    await Promise.all(
      body.assets.map((asset) =>
        dbAdapter.insertAsset({
          key: asset.key,
          url: asset.url,
          content_type: asset.contentType,
        }),
      ),
    );

    // Insert update into database
    await dbAdapter.insertUpdate({
      id: body.manifest.id,
      runtime_version: body.runtimeVersion,
      platform: body.platform,
      created_at: body.manifest.createdAt,
      manifest: body.manifest,
      signature: body.signature,
    });

    // Link update to assets concurrently
    await Promise.all(
      body.assets.map((asset) => dbAdapter.insertUpdateAsset(body.manifest.id, asset.key)),
    );

    console.log(
      `Published update ${body.manifest.id} for runtime ${body.runtimeVersion} on ${body.platform} with ${body.assets.length} assets`,
    );

    triggerCleanupJob(body.runtimeVersion, body.platform);

    res.statusCode = 200;
    res.json({
      success: true,
      updateId: body.manifest.id,
      runtimeVersion: body.runtimeVersion,
      platform: body.platform,
      assetsWritten: writtenAssets.length,
    });
  } catch (error: any) {
    console.error('Publish error:', error);
    res.statusCode = 500;
    res.json({ error: error.message || 'Internal server error during publish.' });
  }
}
