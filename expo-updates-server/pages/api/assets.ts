import fs from 'fs';
import path from 'path';
import { NextApiRequest, NextApiResponse } from 'next';

/**
 * Dynamic asset serving endpoint.
 *
 * Next.js in production mode only serves files in public/ that existed at
 * build time. Since OTA assets are uploaded dynamically via POST /api/publish,
 * we need this route to serve them.
 *
 * Route: GET /api/assets?asset=<filename>
 */

const ASSETS_DIR = path.join(process.cwd(), 'public', 'updates', 'assets');

const CONTENT_TYPES: Record<string, string> = {
  '.bundle': 'application/javascript',
  '.js': 'application/javascript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export default function assetsEndpoint(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.json({ error: 'Expected GET.' });
    return;
  }

  const assetName = req.query.asset;
  if (!assetName || typeof assetName !== 'string') {
    res.statusCode = 400;
    res.json({ error: 'Missing asset query parameter.' });
    return;
  }

  // Prevent directory traversal
  const safeName = path.basename(assetName);
  if (safeName !== assetName) {
    res.statusCode = 400;
    res.json({ error: 'Invalid asset name. Expected a filename only.' });
    return;
  }

  const filePath = path.join(ASSETS_DIR, safeName);

  if (!fs.existsSync(filePath)) {
    res.statusCode = 404;
    res.json({ error: 'Asset not found.' });
    return;
  }

  const ext = path.extname(safeName).toLowerCase();
  const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';

  const stat = fs.statSync(filePath);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
}
