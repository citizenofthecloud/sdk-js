# @citizenofthecloud/sdk

Identity and authentication for autonomous AI agents. JavaScript / TypeScript SDK.

**Prove who you are. Verify who you're talking to.**

## Install

This SDK is currently distributed directly from GitHub. The published npm version (`@citizenofthecloud/sdk`) is not yet caught up with the latest features (most recently: `registerAgent()` and SDK-token auth). For now, install from GitHub:

```bash
# Add directly as a git dependency
npm install github:citizenofthecloud/sdk-js
```

Or in `package.json`:

```json
"dependencies": {
  "@citizenofthecloud/sdk": "github:citizenofthecloud/sdk-js"
}
```

Or clone and link locally for development:

```bash
git clone https://github.com/citizenofthecloud/sdk-js.git
cd sdk-js && npm install && npm link
# then in your project:
npm link @citizenofthecloud/sdk
```

## Quick Start

### Register a new agent (one-time setup)

Bootstrap a new Cloud Identity agent in a single call. Generates a fresh Ed25519 keypair locally, posts the public key to the registry under your SDK token, and returns the `cloudId` together with both keys. The private key never leaves your process — store it securely.

Get an SDK token from [citizenofthecloud.com/account](https://citizenofthecloud.com/account).

```js
import { registerAgent } from '@citizenofthecloud/sdk';

const result = await registerAgent({
  sdkToken: process.env.COTC_SDK_TOKEN,
  name: 'My Research Bot',
  declaredPurpose: 'Summarize papers and surface trends',
  autonomyLevel: 'tool',
});

console.log(result.cloudId);
console.log(result.publicKey);
console.log(result.privateKey);   // STORE SECURELY — the server keeps only the public key
```

The returned `cloudId` and `privateKey` are the inputs to `CloudIdentity` for signing subsequent requests.

### Sign outbound requests (prove your identity)

```js
import { CloudIdentity } from '@citizenofthecloud/sdk';

const me = new CloudIdentity({
  cloudId: process.env.CLOUD_ID,
  privateKey: process.env.CLOUD_PRIVATE_KEY,
});

const response = await fetch('https://other-agent.com/api/task', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    ...me.sign(),
  },
  body: JSON.stringify({ task: 'analyze this' }),
});
```

### Verify inbound requests (check their identity)

```js
import { verifyAgent } from '@citizenofthecloud/sdk';

const result = await verifyAgent(req.headers);

if (result.verified) {
  console.log(`Verified: ${result.agent.name}`);
  console.log(`Trust: ${result.agent.trust_score}`);
} else {
  console.log(`Rejected: ${result.reason}`);
}
```

### Express middleware (one-line protection)

```js
import { cloudGuard } from '@citizenofthecloud/sdk/express';

app.post('/api/task', cloudGuard(), (req, res) => {
  // req.cloudAgent has the verified agent data
  console.log(`Request from ${req.cloudAgent.name}`);
});
```

### Generate keys without registering

If you want to manage registration yourself (or already have a keypair):

```js
import { generateKeyPair } from '@citizenofthecloud/sdk';

const { publicKey, privateKey } = generateKeyPair();
// Submit publicKey when registering manually at citizenofthecloud.com
// Keep privateKey secret — use it to sign requests
```

## Environment Variables

| Variable | Description |
|---|---|
| `CLOUD_ID` | Your agent's Cloud ID (e.g., `cc-7f3a9b2e-...`) |
| `CLOUD_PRIVATE_KEY` | Your agent's Ed25519 private key (PEM format) |
| `COTC_SDK_TOKEN` | Bootstrap SDK token (`cotc_sdk_*`) for `registerAgent()`. Obtain from [citizenofthecloud.com/account](https://citizenofthecloud.com/account). |

## API Reference

See the [SDK Specification](https://citizenofthecloud.com/spec) for full documentation.

## Links

- [Citizen of the Cloud](https://citizenofthecloud.com)
- [SDK Documentation](https://citizenofthecloud.com/docs)
- [Account / SDK tokens](https://citizenofthecloud.com/account)

## License

MIT
