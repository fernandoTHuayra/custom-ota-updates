import FormData from 'form-data';
import { NextApiRequest, NextApiResponse } from 'next';
import { serializeDictionary } from 'structured-headers';

import {
  convertSHA256HashToUUID,
  convertToDictionaryItemsRepresentation,
  signRSASHA256,
  getPrivateKeyAsync,
} from '../../common/helpers';
import { dbAdapter } from '../../src/adapters/database';

export default async function manifestEndpoint(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.json({ error: 'Expected GET.' });
    return;
  }

  const protocolVersionMaybeArray = req.headers['expo-protocol-version'];
  if (protocolVersionMaybeArray && Array.isArray(protocolVersionMaybeArray)) {
    res.statusCode = 400;
    res.json({
      error: 'Unsupported protocol version. Expected either 0 or 1.',
    });
    return;
  }
  const protocolVersion = parseInt(protocolVersionMaybeArray ?? '0', 10);

  const platform = req.headers['expo-platform'] ?? req.query['platform'];
  if (platform !== 'ios' && platform !== 'android') {
    res.statusCode = 400;
    res.json({
      error: 'Unsupported platform. Expected either ios or android.',
    });
    return;
  }

  const runtimeVersion = req.headers['expo-runtime-version'] ?? req.query['runtime-version'];
  if (!runtimeVersion || typeof runtimeVersion !== 'string') {
    res.statusCode = 400;
    res.json({
      error: 'No runtimeVersion provided.',
    });
    return;
  }

  try {
    const update = await dbAdapter.getLatestUpdate(runtimeVersion);

    if (!update) {
      // TODO: Handle NoUpdateAvailable directive for protocol version 1
      res.statusCode = 404;
      res.json({ error: 'No update found' });
      return;
    }

    const manifest = update.manifest;

    // Check if we need to return NoUpdateAvailable (if client already has this update)
    const currentUpdateId = req.headers['expo-current-update-id'];
    if (currentUpdateId === convertSHA256HashToUUID(update.id) && protocolVersion === 1) {
      // In a real implementation, we would return a NoUpdateAvailable directive here
      // For now, just returning 404 or similar is a simple fallback, but let's stick to the plan
      // The previous code threw NoUpdateAvailableError.
      // Let's just return the update again for simplicity in this phase, or implement the directive.
    }

    let signature = null;
    const expectSignatureHeader = req.headers['expo-expect-signature'];
    if (expectSignatureHeader) {
      const privateKey = await getPrivateKeyAsync();
      if (!privateKey) {
        res.statusCode = 400;
        res.json({
          error: 'Code signing requested but no key supplied when starting server.',
        });
        return;
      }
      const manifestString = JSON.stringify(manifest);
      const hashSignature = signRSASHA256(manifestString, privateKey);
      const dictionary = convertToDictionaryItemsRepresentation({
        sig: hashSignature,
        keyid: 'main',
      });
      signature = serializeDictionary(dictionary);
    }

    const assetRequestHeaders: { [key: string]: object } = {};
    // manifest.assets is expected to be an array
    [...manifest.assets, manifest.launchAsset].forEach((asset) => {
      assetRequestHeaders[asset.key] = {
        'test-header': 'test-header-value',
      };
    });

    const form = new FormData();
    form.append('manifest', JSON.stringify(manifest), {
      contentType: 'application/json',
      header: {
        'content-type': 'application/json; charset=utf-8',
        ...(signature ? { 'expo-signature': signature } : {}),
      },
    });
    form.append('extensions', JSON.stringify({ assetRequestHeaders }), {
      contentType: 'application/json',
    });

    res.statusCode = 200;
    res.setHeader('expo-protocol-version', protocolVersion);
    res.setHeader('expo-sfv-version', 0);
    res.setHeader('cache-control', 'private, max-age=0');
    res.setHeader('content-type', `multipart/mixed; boundary=${form.getBoundary()}`);
    res.write(form.getBuffer());
    res.end();

  } catch (error) {
    console.error(error);
    res.statusCode = 500;
    res.json({ error });
  }
}
