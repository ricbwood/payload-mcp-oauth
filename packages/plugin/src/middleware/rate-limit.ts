export interface RateLimitConfig {
  windowMs: number
  maxRequests: number
}

export interface RateLimiter {
  check(key: string): boolean
}

interface Bucket {
  count: number
  resetAt: number
}

export function createRateLimiter(config: RateLimitConfig): RateLimiter {
  const buckets = new Map<string, Bucket>()

  // Evict expired buckets periodically to avoid unbounded growth.
  // We do a lazy sweep on each check rather than a setInterval (no background timer to clean up).
  return {
    check(key: string): boolean {
      const now = Date.now()

      // Lazy eviction: clear expired entries every ~1000 checks
      if (buckets.size > 1000) {
        for (const [k, b] of buckets) {
          if (b.resetAt <= now) buckets.delete(k)
        }
      }

      let bucket = buckets.get(key)
      if (!bucket || bucket.resetAt <= now) {
        bucket = { count: 0, resetAt: now + config.windowMs }
        buckets.set(key, bucket)
      }

      bucket.count += 1
      return bucket.count <= config.maxRequests
    },
  }
}

export interface RateLimitStore {
  register: RateLimiter
  authorize: RateLimiter
  token: RateLimiter
  revoke: RateLimiter
}

export interface RateLimitOptions {
  register?: Partial<RateLimitConfig>
  authorize?: Partial<RateLimitConfig>
  token?: Partial<RateLimitConfig>
  revoke?: Partial<RateLimitConfig>
}

const DEFAULTS: Record<keyof RateLimitStore, RateLimitConfig> = {
  register: { windowMs: 60_000, maxRequests: 10 },
  authorize: { windowMs: 60_000, maxRequests: 60 },
  token: { windowMs: 60_000, maxRequests: 60 },
  revoke: { windowMs: 60_000, maxRequests: 60 },
}

export function createRateLimitStore(overrides: RateLimitOptions = {}): RateLimitStore {
  return {
    register: createRateLimiter({ ...DEFAULTS.register, ...overrides.register }),
    authorize: createRateLimiter({ ...DEFAULTS.authorize, ...overrides.authorize }),
    token: createRateLimiter({ ...DEFAULTS.token, ...overrides.token }),
    revoke: createRateLimiter({ ...DEFAULTS.revoke, ...overrides.revoke }),
  }
}

export function rateLimitKey(ip: string | undefined, clientId?: string): string {
  // Always include the IP so rotating client_ids cannot bypass per-IP limits.
  const ipPart = `ip:${ip ?? 'unknown'}`
  return clientId ? `${ipPart}|cid:${clientId}` : ipPart
}

export function applyRateLimit(
  limiter: RateLimiter,
  key: string,
  res: { status: (n: number) => { json: (o: unknown) => void }; setHeader: (k: string, v: string) => void },
): boolean {
  if (!limiter.check(key)) {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Retry-After', '60')
    res.status(429).json({ error: 'too_many_requests', error_description: 'Rate limit exceeded' })
    return false
  }
  return true
}
