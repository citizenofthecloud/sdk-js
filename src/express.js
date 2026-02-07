/**
 * Express.js middleware for Cloud Identity verification.
 *
 * @example
 * import { cloudGuard } from '@citizenofthecloud/sdk/express';
 *
 * app.use(cloudGuard());
 *
 * app.post('/api/task', cloudGuard({ minimumTrustScore: 0.7 }), (req, res) => {
 *   console.log(req.cloudAgent.name);
 * });
 */

import { verifyAgent } from './index.js';

/**
 * Creates Express middleware that verifies Cloud Identity headers.
 * On success, attaches the verified agent to req.cloudAgent.
 * On failure, returns 401 with rejection details.
 *
 * @param {Object} [options] - Same options as verifyAgent
 * @returns {Function} Express middleware
 */
export function cloudGuard(options = {}) {
  return async (req, res, next) => {
    const result = await verifyAgent(req.headers, options);

    if (result.verified) {
      req.cloudAgent = result.agent;
      req.cloudVerification = result;
      next();
    } else {
      res.status(401).json({
        error: 'Cloud Identity verification failed',
        reason: result.reason,
      });
    }
  };
}
