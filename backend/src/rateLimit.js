/**
 * rateLimit.js
 *
 * Optional, best-effort rate limiting keyed by client IP, backed by a
 * Cloudflare KV namespace. Entirely inert if the `RATE_LIMIT_KV` binding
 * isn't configured (see wrangler.toml) - a fresh deployment works
 * without it, and it can be added later without a code change, matching
 * the task's "implement reasonable rate limiting if supported" (KV is a
 * standard, always-available Workers primitive; this project doesn't
 * assume any paid/beta-only rate-limiting product feature).
 *
 * Fixed window, not sliding - simple and cheap, appropriate for
 * deterring accidental retry storms/scripted abuse, not a precision
 * traffic-shaping tool.
 */

const WINDOW_SECONDS = 60;
const DEFAULT_MAX_PER_WINDOW = 20;

/**
 * @param {KVNamespace|undefined} kv
 * @param {string} clientIp
 * @param {number} [maxPerWindow]
 * @returns {Promise<{ limited: boolean, remaining: number }>}
 */
export async function checkRateLimit(kv, clientIp, maxPerWindow = DEFAULT_MAX_PER_WINDOW) {
  if (!kv || !clientIp) return { limited: false, remaining: maxPerWindow };

  const windowId = Math.floor(Date.now() / 1000 / WINDOW_SECONDS);
  const key = `ratelimit:${clientIp}:${windowId}`;

  let count = 0;
  try {
    const raw = await kv.get(key);
    count = raw ? parseInt(raw, 10) || 0 : 0;
  } catch (e) {
    // KV read failure should never block a legitimate submission.
    return { limited: false, remaining: maxPerWindow };
  }

  if (count >= maxPerWindow) {
    return { limited: true, remaining: 0 };
  }

  try {
    await kv.put(key, String(count + 1), { expirationTtl: WINDOW_SECONDS * 2 });
  } catch (e) {
    // Same reasoning - a failed write just means this request isn't counted.
  }

  return { limited: false, remaining: maxPerWindow - count - 1 };
}

export { WINDOW_SECONDS, DEFAULT_MAX_PER_WINDOW };
