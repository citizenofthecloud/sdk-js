# @citizenofthecloud/sdk

Identity and authentication for autonomous AI agents. JavaScript / TypeScript SDK.

**Prove who you are. Verify who you're talking to.**

The Citizen of the Cloud SDK exposes **17 tools** across the agent identity protocol — registration, signing, verification, the challenge/respond loop, registry queries, and an Express route-guard middleware.

---

## Install

```bash
# From GitHub (latest — recommended while npm catches up)
npm install github:citizenofthecloud/sdk-js

# From npm (may lag behind GitHub)
npm install @citizenofthecloud/sdk
```

Requires Node 18+.

---

## The 17-tool surface

| # | Tool | API | Purpose |
|---|---|---|---|
| 1 | lookup-agent | `lookupAgent(registryUrl, cloudId)` | Read another agent's public passport |
| 2 | get-server-identity | `identity.getPassport()` | Fetch your own passport |
| 3 | list-directory | `listDirectory(registryUrl)` | Browse the public agent directory |
| 4 | governance-feed | `getGovernanceFeed(registryUrl)` | Read recent registry events |
| 5 | verify-agent | `verifyAgent(headers, opts?)` | Verify signed headers (simple) |
| 6 | verify-request | `verifyRequest(headers, url, method, body, opts?)` | Verify request-bound signature |
| 7 | request-challenge | `requestChallenge(registryUrl, cloudId)` | Ask the registry for a nonce |
| 8 | respond-to-challenge | `submitChallengeResponse(...)` | Submit a signed nonce |
| 9 | prove-identity | `identity.proveIdentity()` | Full challenge/sign/respond loop |
| 10 | sign-headers | `identity.sign()` | Produce timestamp-bound headers |
| 11 | sign-request | `identity.signRequest(url, method, body)` | Produce request-bound headers |
| 12 | cloud-fetch | `cloudFetch(identity, url, opts?)` | Auto-signed `fetch()` |
| 13 | generate-keypair | `generateKeyPair()` | Make a fresh Ed25519 keypair |
| 14 | trust-policy | `new TrustPolicy({...})` | Reusable verification rules |
| 15 | clear-cache | `clearCache()` | Clear the verification cache |
| 16 | http-middleware | `cloudGuard(policy?)` (from `/express`) | Express route guard |
| 17 | register-agent | `registerAgent({...})` | Programmatic agent registration |

---

## Quick start (register → sign → verify)

```js
import {
  registerAgent,
  CloudIdentity,
  verifyAgent,
} from '@citizenofthecloud/sdk';

// 1. Register a new agent (one-time; needs an SDK token from /account)
const reg = await registerAgent({
  sdkToken: process.env.COTC_SDK_TOKEN,
  name: 'My Research Bot',
  declaredPurpose: 'Summarize papers and surface trends',
  autonomyLevel: 'tool',
});
console.log(reg.cloudId);     // cc-...
console.log(reg.privateKey);  // STORE SECURELY

// 2. Sign an outbound request
const me = new CloudIdentity({
  cloudId: reg.cloudId,
  privateKey: reg.privateKey,
});
const res = await fetch('https://other-agent.com/api/task', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...me.sign() },
  body: JSON.stringify({ task: 'analyze' }),
});

// 3. On the receiving side — verify an inbound request
const result = await verifyAgent(req.headers);
if (result.verified) {
  console.log(`Verified: ${result.agent.name} (trust ${result.agent.trust_score})`);
}
```

---

## Examples per surface

### Key management (#13 generate-keypair)

```js
import { generateKeyPair } from '@citizenofthecloud/sdk';
const { publicKey, privateKey } = generateKeyPair();
// Submit publicKey when registering manually; keep privateKey secret.
```

### Registration (#17 register-agent)

```js
import { registerAgent } from '@citizenofthecloud/sdk';

const result = await registerAgent({
  sdkToken: process.env.COTC_SDK_TOKEN,
  name: 'My Research Bot',
  declaredPurpose: 'Summarize papers and surface trends',
  autonomyLevel: 'tool',        // 'tool' | 'assistant' | 'agent' | 'self-directing'
  capabilities: ['summarize', 'cite'],
  operationalDomain: 'research-lab.example.com',
});
```

### Outbound signing (#10 sign-headers, #11 sign-request, #12 cloud-fetch)

```js
import { CloudIdentity, cloudFetch } from '@citizenofthecloud/sdk';

const me = new CloudIdentity({
  cloudId: process.env.CLOUD_ID,
  privateKey: process.env.CLOUD_PRIVATE_KEY,
});

// 10 — simple (signs cloud_id + timestamp)
const headers = me.sign();

// 11 — request-bound (also signs URL + method + body hash)
const reqHeaders = me.signRequest(
  'https://other.example.com/api/data',
  'POST',
  JSON.stringify({ q: 'x' }),
);

// 12 — convenience: fetch() with auto-signed request-bound headers
const res = await cloudFetch(me, 'https://other.example.com/api/data', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ q: 'x' }),
});
```

### Inbound verification (#5 verify-agent, #6 verify-request, #14 trust-policy)

```js
import { verifyAgent, verifyRequest, TrustPolicy } from '@citizenofthecloud/sdk';

const policy = new TrustPolicy({
  minimumTrustScore: 0.5,
  requireCovenant: true,
  allowedAutonomyLevels: ['agent', 'assistant'],
});

// 5 — simple header verification
const r1 = await verifyAgent(req.headers, { policy });

// 6 — request-bound (catches URL/method/body tampering)
const r2 = await verifyRequest(
  req.headers,
  req.url, req.method, await req.text(),
  { policy },
);

if (!r2.verified) return res.status(401).json({ reason: r2.reason });
console.log(`Verified ${r2.agent.name}`);
```

### Challenge / Respond (#7, #8, #9 prove-identity)

```js
import {
  requestChallenge,
  submitChallengeResponse,
  CloudIdentity,
} from '@citizenofthecloud/sdk';

const me = new CloudIdentity({ cloudId, privateKey });

// 9 — full self-prove loop in one call
const verified = await me.proveIdentity();
console.log(verified.verified);  // true

// Or — compose the three steps manually:
// 7 — request challenge
const { nonce } = await requestChallenge('https://citizenofthecloud.com', cloudId);
// (signing step is internal to CloudIdentity)
// 8 — submit response
const signature = /* base64(sign(nonce_utf8_bytes)) */;
const result = await submitChallengeResponse(
  'https://citizenofthecloud.com', cloudId, nonce, signature,
);
```

### Registry queries (#1, #2, #3, #4)

```js
import {
  lookupAgent,
  listDirectory,
  getGovernanceFeed,
  CloudIdentity,
} from '@citizenofthecloud/sdk';

// 1 — Look up another agent
const agent = await lookupAgent('https://citizenofthecloud.com', 'cc-abc...');

// 2 — Fetch your own passport
const me = new CloudIdentity({ cloudId, privateKey });
const myPassport = await me.getPassport();

// 3 — Browse the public directory
const all = await listDirectory('https://citizenofthecloud.com');

// 4 — Read the governance event feed
const feed = await getGovernanceFeed('https://citizenofthecloud.com');
```

### Express route guard (#16 http-middleware)

```js
import express from 'express';
import { cloudGuard } from '@citizenofthecloud/sdk/express';
import { TrustPolicy } from '@citizenofthecloud/sdk';

const app = express();
app.use(express.json());

// One-line protection — verified agent attached to req.cloudAgent
app.post(
  '/api/task',
  cloudGuard(new TrustPolicy({ minimumTrustScore: 0.5 })),
  (req, res) => {
    console.log(`Request from ${req.cloudAgent.name}`);
    res.json({ status: 'ok' });
  },
);
```

### Cache control (#15 clear-cache)

```js
import { clearCache } from '@citizenofthecloud/sdk';
clearCache();  // Useful in tests / after a trust-score update
```

---

## Environment variables

| Variable | Description |
|---|---|
| `CLOUD_ID` | Your agent's Cloud ID (e.g., `cc-7f3a9b2e-...`) |
| `CLOUD_PRIVATE_KEY` | Your agent's Ed25519 private key (PEM format) |
| `COTC_SDK_TOKEN` | Bootstrap SDK token (`cotc_sdk_*`) for `registerAgent()` and `report-agent` flows. Get one at [citizenofthecloud.com/account](https://citizenofthecloud.com/account). |

---

## Links

- [citizenofthecloud.com](https://citizenofthecloud.com)
- [Documentation](https://citizenofthecloud.com/docs)
- [Specification](https://citizenofthecloud.com/spec)
- [Account / SDK tokens](https://citizenofthecloud.com/account)
- Sister SDKs: [sdk-python](https://github.com/citizenofthecloud/sdk-python) · [sdk-go](https://github.com/citizenofthecloud/sdk-go) · [sdk-rust](https://github.com/citizenofthecloud/sdk-rust)
- [MCP server](https://github.com/citizenofthecloud/mcp-server)

## License

MIT
