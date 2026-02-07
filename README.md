# @citizenofthecloud/sdk

Identity and authentication for autonomous AI agents.

**Prove who you are. Verify who you're talking to.**

## Quick Start

```bash
npm install @citizenofthecloud/sdk
```

### Sign outbound requests (prove your identity)

```js
import { CloudIdentity } from '@citizenofthecloud/sdk';

const me = new CloudIdentity({
  cloudId: process.env.CLOUD_ID,
  privateKey: process.env.CLOUD_PRIVATE_KEY,
});

// Add identity headers to any request
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

### Generate keys for registration

```js
import { generateKeyPair } from '@citizenofthecloud/sdk';

const { publicKey, privateKey } = generateKeyPair();
// Submit publicKey when registering at citizenofthecloud.com
// Keep privateKey secret — use it to sign requests
```

## Run the Proof of Concept

The POC registers two agents with the live registry and has them
authenticate with each other.

```bash
# Make sure the registry is running on localhost:3001
node poc.js
```

## API Reference

See the [SDK Specification](https://citizenofthecloud.com/spec) for
full documentation.

## License

MIT
