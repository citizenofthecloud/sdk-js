#!/usr/bin/env node

/**
 * ══════════════════════════════════════════════════════════════
 *  Citizen of the Cloud — Proof of Concept
 *  Two agents authenticating with each other
 * ══════════════════════════════════════════════════════════════
 *
 *  This demo:
 *  1. Generates key pairs for two agents
 *  2. Registers both agents with the live registry
 *  3. Agent A signs a request → Agent B verifies it
 *  4. Agent B signs a request → Agent A verifies it
 *  5. Tests failure cases (bad signature, wrong key, expired timestamp)
 *
 *  Run: node poc.js
 */

import crypto from 'node:crypto';

// ── Inline the core SDK functions so the POC is self-contained ──

const REGISTRY_URL = 'http://localhost:3001';

function makeKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
}

function signHeaders(cloudId, privateKeyPem) {
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const timestamp = new Date().toISOString();
  const payload = `${cloudId}:${timestamp}`;
  const signature = crypto.sign(null, Buffer.from(payload), privateKey);
  return {
    'X-Cloud-ID': cloudId,
    'X-Cloud-Timestamp': timestamp,
    'X-Cloud-Signature': signature.toString('base64url'),
  };
}

async function verifyHeaders(headers) {
  const cloudId = headers['X-Cloud-ID'];
  const timestamp = headers['X-Cloud-Timestamp'];
  const signature = headers['X-Cloud-Signature'];

  if (!cloudId || !timestamp || !signature) {
    return { verified: false, reason: 'missing_headers' };
  }

  // Check timestamp (5 min window)
  const age = (Date.now() - new Date(timestamp).getTime()) / 1000;
  if (age > 300) return { verified: false, reason: 'timestamp_expired' };
  if (age < -30) return { verified: false, reason: 'timestamp_future' };

  // Lookup agent in registry
  const res = await fetch(`${REGISTRY_URL}/api/verify?cloud_id=${encodeURIComponent(cloudId)}`);
  if (!res.ok) return { verified: false, reason: 'invalid_cloud_id' };

  const data = await res.json();
  if (!data.verified || !data.agent) return { verified: false, reason: 'invalid_cloud_id' };

  const agent = data.agent;

  if (agent.status !== 'active') return { verified: false, reason: 'agent_suspended' };
  if (!agent.covenant_signed) return { verified: false, reason: 'covenant_unsigned' };

  // Verify signature
  try {
    const publicKey = crypto.createPublicKey(agent.public_key);
    const payload = `${cloudId}:${timestamp}`;
    const sigBuffer = Buffer.from(signature, 'base64url');
    const valid = crypto.verify(null, Buffer.from(payload), publicKey, sigBuffer);

    if (!valid) return { verified: false, reason: 'invalid_signature', agent };
  } catch (err) {
    return { verified: false, reason: 'invalid_signature', agent };
  }

  return { verified: true, agent };
}

async function registerAgent(name, purpose, autonomyLevel, publicKey) {
  const res = await fetch(`${REGISTRY_URL}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      declared_purpose: purpose,
      autonomy_level: autonomyLevel,
      capabilities: ['api_calls', 'reasoning'],
      operational_domain: 'proof of concept',
      creator: 'citizenofthecloud.com',
      public_key: publicKey,
      covenant_signed: true,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Registration failed: ${data.error}`);
  return data;
}

// ── Pretty printing ──

const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

function header(text) {
  console.log(`\n${BOLD}${CYAN}═══ ${text} ═══${RESET}\n`);
}

function pass(text) {
  console.log(`  ${GREEN}✓${RESET} ${text}`);
}

function fail(text) {
  console.log(`  ${RED}✗${RESET} ${text}`);
}

function info(text) {
  console.log(`  ${DIM}${text}${RESET}`);
}

function warn(text) {
  console.log(`  ${YELLOW}⚠${RESET} ${text}`);
}

// ── Main ──

async function main() {
  console.log(`\n${BOLD}╔══════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}║  CITIZEN OF THE CLOUD — Proof of Concept     ║${RESET}`);
  console.log(`${BOLD}║  Agent-to-Agent Authentication Demo          ║${RESET}`);
  console.log(`${BOLD}╚══════════════════════════════════════════════╝${RESET}`);

  // ── Step 1: Generate keys ──
  header('STEP 1: Generate Key Pairs');

  const keysA = makeKeyPair();
  pass(`Agent A key pair generated (Ed25519)`);
  info(`Public key: ${keysA.publicKey.split('\n')[1].slice(0, 40)}...`);

  const keysB = makeKeyPair();
  pass(`Agent B key pair generated (Ed25519)`);
  info(`Public key: ${keysB.publicKey.split('\n')[1].slice(0, 40)}...`);

  // ── Step 2: Register agents ──
  header('STEP 2: Register Agents');

  let agentA, agentB;
  try {
    agentA = await registerAgent(
      'ResearchBot-POC',
      'Proof of concept agent that requests data analysis from other agents',
      'agent',
      keysA.publicKey,
    );
    pass(`Agent A registered: ${BOLD}${agentA.passport.name}${RESET}`);
    info(`Cloud ID: ${agentA.cloud_id}`);
  } catch (err) {
    fail(`Agent A registration failed: ${err.message}`);
    process.exit(1);
  }

  try {
    agentB = await registerAgent(
      'AnalysisBot-POC',
      'Proof of concept agent that performs data analysis and returns results',
      'agent',
      keysB.publicKey,
    );
    pass(`Agent B registered: ${BOLD}${agentB.passport.name}${RESET}`);
    info(`Cloud ID: ${agentB.cloud_id}`);
  } catch (err) {
    fail(`Agent B registration failed: ${err.message}`);
    process.exit(1);
  }

  // ── Step 3: Agent A → Agent B (valid) ──
  header('STEP 3: Agent A signs request → Agent B verifies');

  const headersAtoB = signHeaders(agentA.cloud_id, keysA.privateKey);
  info(`Signed headers:`);
  info(`  X-Cloud-ID:        ${headersAtoB['X-Cloud-ID']}`);
  info(`  X-Cloud-Timestamp: ${headersAtoB['X-Cloud-Timestamp']}`);
  info(`  X-Cloud-Signature: ${headersAtoB['X-Cloud-Signature'].slice(0, 40)}...`);

  const resultAtoB = await verifyHeaders(headersAtoB);
  if (resultAtoB.verified) {
    pass(`${BOLD}VERIFIED${RESET} — Agent B confirmed Agent A's identity`);
    info(`  Name: ${resultAtoB.agent.name}`);
    info(`  Purpose: ${resultAtoB.agent.declared_purpose}`);
    info(`  Autonomy: ${resultAtoB.agent.autonomy_level}`);
    info(`  Covenant: signed`);
  } else {
    fail(`Verification failed: ${resultAtoB.reason}`);
  }

  // ── Step 4: Agent B → Agent A (valid) ──
  header('STEP 4: Agent B signs request → Agent A verifies');

  const headersBtoA = signHeaders(agentB.cloud_id, keysB.privateKey);
  info(`Signed headers:`);
  info(`  X-Cloud-ID:        ${headersBtoA['X-Cloud-ID']}`);
  info(`  X-Cloud-Timestamp: ${headersBtoA['X-Cloud-Timestamp']}`);
  info(`  X-Cloud-Signature: ${headersBtoA['X-Cloud-Signature'].slice(0, 40)}...`);

  const resultBtoA = await verifyHeaders(headersBtoA);
  if (resultBtoA.verified) {
    pass(`${BOLD}VERIFIED${RESET} — Agent A confirmed Agent B's identity`);
    info(`  Name: ${resultBtoA.agent.name}`);
    info(`  Purpose: ${resultBtoA.agent.declared_purpose}`);
  } else {
    fail(`Verification failed: ${resultBtoA.reason}`);
  }

  // ── Step 5: Failure cases ──
  header('STEP 5: Failure Cases');

  // 5a. Wrong private key
  info('Test: Agent A signs with WRONG key...');
  const wrongKeyHeaders = signHeaders(agentA.cloud_id, keysB.privateKey); // B's key for A's ID
  const wrongKeyResult = await verifyHeaders(wrongKeyHeaders);
  if (!wrongKeyResult.verified && wrongKeyResult.reason === 'invalid_signature') {
    pass(`Correctly rejected: ${wrongKeyResult.reason}`);
  } else {
    fail(`Should have been rejected but was: ${JSON.stringify(wrongKeyResult)}`);
  }

  // 5b. Missing headers
  info('Test: Missing authentication headers...');
  const missingResult = await verifyHeaders({});
  if (!missingResult.verified && missingResult.reason === 'missing_headers') {
    pass(`Correctly rejected: ${missingResult.reason}`);
  } else {
    fail(`Should have been rejected but was: ${JSON.stringify(missingResult)}`);
  }

  // 5c. Fake Cloud ID
  info('Test: Unregistered Cloud ID...');
  const fakeHeaders = signHeaders('cc-00000000-fake-0000-0000-000000000000', keysA.privateKey);
  const fakeResult = await verifyHeaders(fakeHeaders);
  if (!fakeResult.verified && fakeResult.reason === 'invalid_cloud_id') {
    pass(`Correctly rejected: ${fakeResult.reason}`);
  } else {
    fail(`Should have been rejected but was: ${JSON.stringify(fakeResult)}`);
  }

  // 5d. Expired timestamp
  info('Test: Expired timestamp (6 minutes old)...');
  const expiredTime = new Date(Date.now() - 6 * 60 * 1000).toISOString();
  const expiredPayload = `${agentA.cloud_id}:${expiredTime}`;
  const expiredSig = crypto.sign(null, Buffer.from(expiredPayload), crypto.createPrivateKey(keysA.privateKey));
  const expiredHeaders = {
    'X-Cloud-ID': agentA.cloud_id,
    'X-Cloud-Timestamp': expiredTime,
    'X-Cloud-Signature': expiredSig.toString('base64url'),
  };
  const expiredResult = await verifyHeaders(expiredHeaders);
  if (!expiredResult.verified && expiredResult.reason === 'timestamp_expired') {
    pass(`Correctly rejected: ${expiredResult.reason}`);
  } else {
    fail(`Should have been rejected but was: ${JSON.stringify(expiredResult)}`);
  }

  // ── Summary ──
  header('SUMMARY');

  const allPassed = resultAtoB.verified &&
    resultBtoA.verified &&
    !wrongKeyResult.verified &&
    !missingResult.verified &&
    !fakeResult.verified &&
    !expiredResult.verified;

  if (allPassed) {
    console.log(`  ${GREEN}${BOLD}All tests passed.${RESET}`);
    console.log(`  ${DIM}Two autonomous agents successfully authenticated`);
    console.log(`  with each other using the Cloud Identity protocol.`);
    console.log(`  Four attack vectors correctly rejected.${RESET}`);
  } else {
    console.log(`  ${RED}${BOLD}Some tests failed.${RESET}`);
  }

  console.log(`\n  ${DIM}Registry: ${REGISTRY_URL}`);
  console.log(`  Agent A: ${agentA.cloud_id}`);
  console.log(`  Agent B: ${agentB.cloud_id}${RESET}\n`);
}

main().catch(err => {
  console.error(`\n${RED}Fatal error: ${err.message}${RESET}`);
  console.error(err.stack);
  process.exit(1);
});
