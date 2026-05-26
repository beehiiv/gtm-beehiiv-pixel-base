import type { EmailHashes } from './types';

export async function hashEmail(email: string): Promise<EmailHashes> {
  if (!email) {
    return { email_hash_sha256: '', email_hash_sha1: '' };
  }
  const [email_hash_sha256, email_hash_sha1] = await Promise.all([
    generateHash(email, 'SHA-256'),
    generateHash(email, 'SHA-1'),
  ]);
  return { email_hash_sha256, email_hash_sha1 };
}

async function generateHash(input: string, algorithm: AlgorithmIdentifier): Promise<string> {
  const msgBuffer = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest(algorithm, msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
