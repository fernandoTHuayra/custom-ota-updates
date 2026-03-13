import FormData from 'form-data';
import { NextApiRequest, NextApiResponse } from 'next';

import {
  convertSHA256HashToUUID,
  formatExpoSignatureHeader,
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
      res.statusCode = 404;
      res.json({ error: 'No update found' });
      return;
    }

    const manifest = update.manifest;

    // If the client already has this update, no need to re-download
    const currentUpdateId = req.headers['expo-current-update-id'];
    if (currentUpdateId === convertSHA256HashToUUID(update.id) && protocolVersion === 1) {
      res.statusCode = 200;
      const noUpdateDirective = { type: 'noUpdateAvailable' };

      let signature = null;
      const expectSignatureHeader = req.headers['expo-expect-signature'];
      if (expectSignatureHeader) {
        const privateKey = await getPrivateKeyAsync();
        if (privateKey) {
          const directiveString = JSON.stringify(noUpdateDirective);
          const hashSignature = signRSASHA256(directiveString, privateKey);
          signature = formatExpoSignatureHeader(hashSignature);
        }
      }

      const form = new FormData();
      form.append('directive', JSON.stringify(noUpdateDirective), {
        contentType: 'application/json',
        header: {
          'content-type': 'application/json; charset=utf-8',
          ...(signature ? { 'expo-signature': signature } : {}),
        },
      });

      res.setHeader('expo-protocol-version', 1);
      res.setHeader('expo-sfv-version', 0);
      res.setHeader('cache-control', 'private, max-age=0');
      res.setHeader('content-type', `multipart/mixed; boundary=${form.getBoundary()}`);
      res.write(form.getBuffer());
      res.end();
      return;
    }

    let signature = null;
    const expectSignatureHeader = req.headers['expo-expect-signature'];
    if (expectSignatureHeader) {
      if (update.signature) {
        signature = formatExpoSignatureHeader(update.signature);
      } else {
        const privateKey = await getPrivateKeyAsync();
        if (!privateKey) {
          res.statusCode = 400;
          res.json({
            error:
              'Code signing requested but no stored signature is available for this legacy update.',
          });
          return;
        }
        const manifestString = JSON.stringify(manifest);
        const hashSignature = signRSASHA256(manifestString, privateKey);
        signature = formatExpoSignatureHeader(hashSignature);
      }
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
