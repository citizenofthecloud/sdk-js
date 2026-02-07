/**
 * @citizenofthecloud/sdk
 *
 * Identity and authentication for autonomous AI agents.
 * Prove who you are. Verify who you're talking to.
 */

import crypto from 'node:crypto';

const DEFAULT_REGISTRY = 'https://citizenofthecloud.com';
const DEFAULT_MAX_AGE = 300; // 5 minutes

// ─── Key Generation ──────────────────────────────────────────

/**
 * Generate an Ed25519 key pair for agent identity.
 * Submit the publicKey during registration.
 * Keep the privateKey secret — use it to sign requests.
 *
 * @returns {{ publicKey: string, privateKey: string }} PEM-encoded key pair
 */
export function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
}

// ─── Cloud Identity ──────────────────────────────────────────

/**
 * Represents an agent's identity. Used to sign outbound requests.
 *
 * @example
 * const identity = new CloudIdentity({
 *   cloudId: 'cc-7f3a9b2e-...',
 *   privateKey: process.env.CLOUD_PRIVATE_KEY,
 * });
 * const headers = await identity.sign();
 */
export class CloudIdentity {
  /**
   * @param {Object} config
   * @param {string} config.cloudId - The agent's Cloud ID
   * @param {string} config.privateKey - Ed25519 private key (PEM format)
   * @param {string} [config.registryUrl] - Registry URL (default: citizenofthecloud.com)
   */
  constructor({ cloudId, privateKey, registryUrl }) {
    if (!cloudId) throw new CloudSDKError('cloudId is required');
    if (!privateKey) throw new CloudSDKError('privateKey is required');

    this.cloudId = cloudId;
    this.registryUrl = (registryUrl || DEFAULT_REGISTRY).replace(/\/$/, '');

    // Parse the private key
    try {
      this._privateKey = crypto.createPrivateKey(privateKey);
    } catch (err) {
      throw new CloudSDKError(`Invalid private key: ${err.message}`);
    }
  }

  /**
   * Generate authentication headers for an outbound request.
   * Signature covers: {cloudId}:{timestamp}
   *
   * @returns {Object} Headers to include in the request
   */
  sign() {
    const timestamp = new Date().toISOString();
    const payload = `${this.cloudId}:${timestamp}`;
    const signature = crypto.sign(null, Buffer.from(payload), this._privateKey);

    return {
      'X-Cloud-ID': this.cloudId,
      'X-Cloud-Timestamp': timestamp,
      'X-Cloud-Signature': signature.toString('base64url'),
    };
  }

  /**
   * Generate request-bound authentication headers.
   * Signature covers: {cloudId}:{timestamp}:{method}:{url}:{bodyHash}
   * Prevents replay attacks against different endpoints.
   *
   * @param {string} url - The request URL
   * @param {string} method - HTTP method (GET, POST, etc.)
   * @param {string} [body] - Request body (optional)
   * @returns {Object} Headers to include in the request
   */
  signRequest(url, method, body) {
    const timestamp = new Date().toISOString();
    const bodyHash = crypto.createHash('sha256')
      .update(body || '')
      .digest('base64url');
    const payload = `${this.cloudId}:${timestamp}:${method.toUpperCase()}:${url}:${bodyHash}`;
    const signature = crypto.sign(null, Buffer.from(payload), this._privateKey);

    return {
      'X-Cloud-ID': this.cloudId,
      'X-Cloud-Timestamp': timestamp,
      'X-Cloud-Signature': signature.toString('base64url'),
      'X-Cloud-Request-Bound': 'true',
    };
  }

  /**
   * Fetch this agent's passport from the registry.
   *
   * @returns {Object} The agent's passport data
   */
  async getPassport() {
    const url = `${this.registryUrl}/api/verify?cloud_id=${encodeURIComponent(this.cloudId)}`;
    const res = await fetch(url);
    if (!res.ok) throw new RegistryError(`Registry returned ${res.status}`);
    const data = await res.json();
    return data.agent;
  }
}

// ─── Verification ────────────────────────────────────────────

// Simple in-memory cache for public keys
const _cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCached(cloudId) {
  const entry = _cache.get(cloudId);
  if (!entry) return null;
  if (Date.now() - entry.time > CACHE_TTL) {
    _cache.delete(cloudId);
    return null;
  }
  return entry.data;
}

function setCache(cloudId, data) {
  _cache.set(cloudId, { data, time: Date.now() });
}

/**
 * Clear the verification cache.
 */
export function clearCache() {
  _cache.clear();
}

/**
 * Fire-and-forget verification log to the registry.
 * @private
 */
async function _logVerification(registryUrl, cloudId, result, reason, latency) {
  try {
    await fetch(`${registryUrl.replace(/\/$/, '')}/api/verify/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cloud_id: cloudId,
        result,
        reason: reason || null,
        method: 'sdk_headers',
        latency: latency || null,
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Best-effort — don't let logging failures affect verification
  }
}

/**
 * Verify incoming request headers from another agent.
 *
 * @param {Object} headers - Request headers (must include X-Cloud-ID, X-Cloud-Timestamp, X-Cloud-Signature)
 * @param {Object} [options]
 * @param {number} [options.maxAge=300] - Maximum signature age in seconds
 * @param {boolean} [options.requireCovenant=true] - Reject if covenant not signed
 * @param {number} [options.minimumTrustScore] - Reject below this trust score
 * @param {string[]} [options.allowedAutonomyLevels] - Restrict to these levels
 * @param {string[]} [options.blockedAgents] - Reject these Cloud IDs
 * @param {string} [options.registryUrl] - Custom registry URL
 * @param {boolean} [options.cache=true] - Cache public keys
 * @returns {VerificationResult}
 */
export async function verifyAgent(headers, options = {}) {
  const result = await _verifyAgentInner(headers, options);

  // Log the verification result (best-effort, non-blocking)
  const opts = { registryUrl: DEFAULT_REGISTRY, ...options };
  const cloudId = headers['X-Cloud-ID'] || headers['x-cloud-id'] || 'unknown';
  const logResult = result.verified ? 'success' : (result.reason || 'unknown');
  _logVerification(
    opts.registryUrl,
    cloudId,
    logResult,
    result.reason,
    result.latency,
  );

  return result;
}

async function _verifyAgentInner(headers, options = {}) {
  const start = Date.now();
  const opts = {
    maxAge: DEFAULT_MAX_AGE,
    requireCovenant: true,
    minimumTrustScore: null,
    allowedAutonomyLevels: null,
    blockedAgents: null,
    registryUrl: DEFAULT_REGISTRY,
    cache: true,
    ...options,
  };

  // Normalize headers (support both lowercase and mixed case)
  const get = (name) => headers[name] || headers[name.toLowerCase()] || null;

  const cloudId = get('X-Cloud-ID');
  const timestamp = get('X-Cloud-Timestamp');
  const signature = get('X-Cloud-Signature');

  // 1. Check headers present
  if (!cloudId || !timestamp || !signature) {
    return {
      verified: false,
      reason: 'missing_headers',
      latency: Date.now() - start,
    };
  }

  // 2. Check blocked list
  if (opts.blockedAgents && opts.blockedAgents.includes(cloudId)) {
    return {
      verified: false,
      reason: 'agent_blocked',
      latency: Date.now() - start,
    };
  }

  // 3. Validate timestamp
  const signedAt = new Date(timestamp);
  if (isNaN(signedAt.getTime())) {
    return {
      verified: false,
      reason: 'invalid_timestamp',
      latency: Date.now() - start,
    };
  }

  const age = (Date.now() - signedAt.getTime()) / 1000;
  if (age > opts.maxAge) {
    return {
      verified: false,
      reason: 'timestamp_expired',
      latency: Date.now() - start,
    };
  }
  if (age < -30) {
    // Allow 30s clock skew into the future
    return {
      verified: false,
      reason: 'timestamp_future',
      latency: Date.now() - start,
    };
  }

  // 4. Lookup agent in registry (with cache)
  let agentData;
  try {
    if (opts.cache) {
      agentData = getCached(cloudId);
    }

    if (!agentData) {
      const registryUrl = (opts.registryUrl || DEFAULT_REGISTRY).replace(/\/$/, '');
      const url = `${registryUrl}/api/verify?cloud_id=${encodeURIComponent(cloudId)}`;
      const res = await fetch(url);

      if (!res.ok) {
        return {
          verified: false,
          reason: res.status === 404 ? 'invalid_cloud_id' : 'registry_error',
          latency: Date.now() - start,
        };
      }

      const json = await res.json();
      if (!json.verified || !json.agent) {
        return {
          verified: false,
          reason: 'invalid_cloud_id',
          latency: Date.now() - start,
        };
      }

      agentData = json.agent;

      if (opts.cache) {
        setCache(cloudId, agentData);
      }
    }
  } catch (err) {
    return {
      verified: false,
      reason: 'registry_unreachable',
      latency: Date.now() - start,
    };
  }

  // 5. Check agent status
  if (agentData.status !== 'active') {
    return {
      verified: false,
      reason: 'agent_suspended',
      agent: agentData,
      latency: Date.now() - start,
    };
  }

  // 6. Check covenant
  if (opts.requireCovenant && !agentData.covenant_signed) {
    return {
      verified: false,
      reason: 'covenant_unsigned',
      agent: agentData,
      latency: Date.now() - start,
    };
  }

  // 7. Check trust score
  if (opts.minimumTrustScore != null && (agentData.trust_score == null || agentData.trust_score < opts.minimumTrustScore)) {
    return {
      verified: false,
      reason: 'trust_score_insufficient',
      agent: agentData,
      latency: Date.now() - start,
    };
  }

  // 8. Check autonomy level
  if (opts.allowedAutonomyLevels && !opts.allowedAutonomyLevels.includes(agentData.autonomy_level)) {
    return {
      verified: false,
      reason: 'autonomy_level_restricted',
      agent: agentData,
      latency: Date.now() - start,
    };
  }

  // 9. Verify cryptographic signature
  try {
    const publicKey = crypto.createPublicKey(agentData.public_key);
    const payload = `${cloudId}:${timestamp}`;
    const sigBuffer = Buffer.from(signature, 'base64url');
    const valid = crypto.verify(null, Buffer.from(payload), publicKey, sigBuffer);

    if (!valid) {
      // Invalidate cache on sig failure
      _cache.delete(cloudId);
      return {
        verified: false,
        reason: 'invalid_signature',
        agent: agentData,
        latency: Date.now() - start,
      };
    }
  } catch (err) {
    return {
      verified: false,
      reason: 'invalid_signature',
      agent: agentData,
      latency: Date.now() - start,
    };
  }

  // 10. All checks passed
  return {
    verified: true,
    agent: agentData,
    timestamp,
    latency: Date.now() - start,
  };
}

/**
 * Verify incoming request with request-bound signature.
 * Stricter than verifyAgent — also validates method, URL, and body.
 *
 * @param {Object} headers - Request headers
 * @param {string} url - The request URL
 * @param {string} method - HTTP method
 * @param {string} [body] - Request body
 * @param {Object} [options] - Same options as verifyAgent
 * @returns {VerificationResult}
 */
export async function verifyRequest(headers, url, method, body, options = {}) {
  const start = Date.now();

  const get = (name) => headers[name] || headers[name.toLowerCase()] || null;

  const cloudId = get('X-Cloud-ID');
  const timestamp = get('X-Cloud-Timestamp');
  const signature = get('X-Cloud-Signature');
  const requestBound = get('X-Cloud-Request-Bound');

  if (!requestBound) {
    // Fall back to basic verification if not request-bound
    return verifyAgent(headers, options);
  }

  // Run all the same checks as verifyAgent but with different payload
  const basicResult = await verifyAgent(headers, { ...options, _skipSignature: true });
  if (!basicResult.verified && basicResult.reason !== 'invalid_signature') {
    return basicResult;
  }

  // Verify request-bound signature
  try {
    const agentData = basicResult.agent;
    const publicKey = crypto.createPublicKey(agentData.public_key);
    const bodyHash = crypto.createHash('sha256').update(body || '').digest('base64url');
    const payload = `${cloudId}:${timestamp}:${method.toUpperCase()}:${url}:${bodyHash}`;
    const sigBuffer = Buffer.from(signature, 'base64url');
    const valid = crypto.verify(null, Buffer.from(payload), publicKey, sigBuffer);

    if (!valid) {
      return {
        verified: false,
        reason: 'invalid_signature',
        agent: agentData,
        latency: Date.now() - start,
      };
    }

    return {
      verified: true,
      agent: agentData,
      timestamp,
      latency: Date.now() - start,
    };
  } catch (err) {
    return {
      verified: false,
      reason: 'invalid_signature',
      latency: Date.now() - start,
    };
  }
}

// ─── Convenience: cloudFetch ─────────────────────────────────

/**
 * Drop-in replacement for fetch that automatically signs requests
 * with Cloud Identity headers.
 *
 * @param {CloudIdentity} identity - The agent's identity
 * @param {string} url - The request URL
 * @param {Object} [options] - Standard fetch options
 * @returns {Promise<Response>}
 */
export async function cloudFetch(identity, url, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const body = options.body || null;
  const authHeaders = identity.signRequest(url, method, body);

  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      ...authHeaders,
    },
  });
}

// ─── Errors ──────────────────────────────────────────────────

export class CloudSDKError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CloudSDKError';
  }
}

export class RegistryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RegistryError';
  }
}
