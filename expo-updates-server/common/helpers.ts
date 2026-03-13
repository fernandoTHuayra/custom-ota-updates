import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

/**
 * Code-signing helpers used by the manifest endpoint.
 */

export function signRSASHA256(data: string, privateKey: string): string {
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(data, 'utf8');
  sign.end();
  return sign.sign(privateKey, 'base64');
}

export function verifyRSASHA256(data: string, signature: string, publicKey: string): boolean {
  const verify = crypto.createVerify('RSA-SHA256');
  verify.update(data, 'utf8');
  verify.end();
  return verify.verify(publicKey, signature, 'base64');
}

export async function getPrivateKeyAsync(): Promise<string | null> {
  const privateKeyPath = process.env.PRIVATE_KEY_PATH;
  if (!privateKeyPath) {
    return null;
  }
  const pemBuffer = await fs.readFile(path.resolve(privateKeyPath));
  return pemBuffer.toString('utf8');
}

export async function getCertificateAsync(): Promise<string | null> {
  const configuredPath = process.env.PUBLIC_CERTIFICATE_PATH;
  const candidatePaths = configuredPath
    ? [configuredPath]
    : [
        path.resolve(process.cwd(), 'certificate.pem'),
        path.resolve(process.cwd(), '..', 'expo-updates-client', 'code-signing', 'certificate.pem'),
      ];

  for (const candidatePath of candidatePaths) {
    try {
      const pemBuffer = await fs.readFile(candidatePath);
      return pemBuffer.toString('utf8');
    } catch {
      continue;
    }
  }

  return null;
}

export function formatExpoSignatureHeader(signature: string): string {
  return `sig="${signature}", keyid="main", alg="rsa-v1_5-sha256"`;
}

export function convertSHA256HashToUUID(value: string): string {
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(
    16,
    20,
  )}-${value.slice(20, 32)}`;
}
