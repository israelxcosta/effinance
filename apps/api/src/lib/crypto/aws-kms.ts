// AWS KMS key provider (production). Data keys come from GenerateDataKey and are unwrapped with
// Decrypt; the encryption context binds each wrapped key to its workspace, and every use is logged in
// CloudTrail. The SDK is loaded lazily so it is never bundled into the browser demo.

import { fromBase64, toBase64Url, fromBase64Url, fromUtf8, utf8, type Bytes } from './encoding';
import type { DataKey, KeyProvider } from './key-provider';

export async function createAwsKmsKeyProvider(options: { keyId: string; region?: string }): Promise<KeyProvider> {
  const { KMSClient, GenerateDataKeyCommand, DecryptCommand, EncryptCommand } = await import('@aws-sdk/client-kms');
  const client = new KMSClient(options.region ? { region: options.region } : {});
  const { keyId } = options;

  return {
    name: 'aws',

    async generateDataKey(workspaceId: string): Promise<DataKey> {
      const out = await client.send(
        new GenerateDataKeyCommand({ KeyId: keyId, KeySpec: 'AES_256', EncryptionContext: { workspaceId } }),
      );
      if (!out.Plaintext || !out.CiphertextBlob) throw new Error('KMS GenerateDataKey sem chave');
      return {
        plaintext: new Uint8Array(out.Plaintext) as Bytes,
        wrapped: toBase64Url(out.CiphertextBlob),
        keyId: out.KeyId ?? keyId,
      };
    },

    async decryptDataKey(workspaceId: string, wrapped: string, wrappedBy: string): Promise<Bytes> {
      const out = await client.send(
        new DecryptCommand({
          CiphertextBlob: fromBase64Url(wrapped),
          KeyId: wrappedBy,
          EncryptionContext: { workspaceId },
        }),
      );
      if (!out.Plaintext) throw new Error('KMS Decrypt sem chave');
      return new Uint8Array(out.Plaintext) as Bytes;
    },

    async encryptSecret(plaintext: string, context: string): Promise<string> {
      const out = await client.send(
        new EncryptCommand({ KeyId: keyId, Plaintext: utf8(plaintext), EncryptionContext: { purpose: 'secret', context } }),
      );
      if (!out.CiphertextBlob) throw new Error('KMS Encrypt sem resultado');
      return `kms.${toBase64Url(out.CiphertextBlob)}`;
    },

    async decryptSecret(ciphertext: string, context: string): Promise<string> {
      const blob = ciphertext.startsWith('kms.') ? fromBase64Url(ciphertext.slice(4)) : fromBase64(ciphertext);
      const out = await client.send(
        new DecryptCommand({ CiphertextBlob: blob, EncryptionContext: { purpose: 'secret', context } }),
      );
      if (!out.Plaintext) throw new Error('KMS Decrypt sem resultado');
      return fromUtf8(out.Plaintext);
    },
  };
}
