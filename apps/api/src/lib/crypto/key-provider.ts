// Envelope encryption: every workspace has its own AES-256 data key, stored only in wrapped form
// (`workspaces.wrapped_key`). The provider wraps/unwraps it with a master key that never touches the
// database: AWS KMS in production (see aws-kms.ts), or a local master key in development and in the
// browser demo.

import { fromBase64Url, fromUtf8, randomBytes, sha256Hex, toBase64Url, utf8, type Bytes } from './encoding';

export interface DataKey {
  /** Raw 32-byte key (kept in memory only). */
  plaintext: Bytes;
  /** Wrapped key to persist. */
  wrapped: string;
  /** Identifies the master key that wrapped it (rotation / sanity check). */
  keyId: string;
}

export interface KeyProvider {
  readonly name: 'local' | 'aws';
  generateDataKey(workspaceId: string): Promise<DataKey>;
  decryptDataKey(workspaceId: string, wrapped: string, keyId: string): Promise<Bytes>;
  /** Small secrets (e.g. TOTP seeds) encrypted directly with the master key, bound to `context`. */
  encryptSecret(plaintext: string, context: string): Promise<string>;
  decryptSecret(ciphertext: string, context: string): Promise<string>;
}

/** AES-256-GCM key wrapping with a master key held by the process (`ENCRYPTION_MASTER_KEY`). */
export class LocalKeyProvider implements KeyProvider {
  readonly name = 'local' as const;

  private constructor(
    private readonly master: CryptoKey,
    private readonly keyId: string,
  ) {}

  /** @param masterKey 32 random bytes. */
  static async create(masterKey: Bytes): Promise<LocalKeyProvider> {
    if (masterKey.length !== 32) throw new Error('ENCRYPTION_MASTER_KEY must decode to 32 bytes');
    const master = await globalThis.crypto.subtle.importKey('raw', masterKey, 'AES-GCM', false, ['encrypt', 'decrypt']);
    const fingerprint = (await sha256Hex(toBase64Url(masterKey))).slice(0, 12);
    return new LocalKeyProvider(master, `local:${fingerprint}`);
  }

  private async seal(plaintext: Bytes, aad: string): Promise<string> {
    const iv = randomBytes(12);
    const ct = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8(aad) }, this.master, plaintext);
    return `${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ct))}`;
  }

  private async open(sealed: string, aad: string): Promise<Bytes> {
    const [iv, ct] = sealed.split('.');
    if (!iv || !ct) throw new Error('Chave cifrada em formato inválido');
    const plain = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64Url(iv), additionalData: utf8(aad) },
      this.master,
      fromBase64Url(ct),
    );
    return new Uint8Array(plain);
  }

  async generateDataKey(workspaceId: string): Promise<DataKey> {
    const plaintext = randomBytes(32);
    return { plaintext, wrapped: await this.seal(plaintext, `dek:${workspaceId}`), keyId: this.keyId };
  }

  async decryptDataKey(workspaceId: string, wrapped: string, keyId: string): Promise<Bytes> {
    if (keyId !== this.keyId) throw new Error(`Chave do workspace foi gerada por outra chave mestra (${keyId})`);
    return this.open(wrapped, `dek:${workspaceId}`);
  }

  async encryptSecret(plaintext: string, context: string): Promise<string> {
    return this.seal(utf8(plaintext), `secret:${context}`);
  }

  async decryptSecret(ciphertext: string, context: string): Promise<string> {
    return fromUtf8(await this.open(ciphertext, `secret:${context}`));
  }
}
