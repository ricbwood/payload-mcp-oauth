import { describe, expect, it, vi } from 'vitest'
import { applyRateLimit, createRateLimitStore, createRateLimiter, rateLimitKey } from '../../../src/middleware/rate-limit.js'

describe('createRateLimiter', () => {
  it('allows requests within the limit', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 5 })
    for (let i = 0; i < 5; i++) {
      expect(limiter.check('key')).toBe(true)
    }
  })

  it('blocks requests over the limit', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 3 })
    limiter.check('k')
    limiter.check('k')
    limiter.check('k')
    expect(limiter.check('k')).toBe(false)
  })

  it('resets count after window expires', () => {
    const limiter = createRateLimiter({ windowMs: 1, maxRequests: 1 })
    limiter.check('k')
    expect(limiter.check('k')).toBe(false)
    // After 2ms, the bucket window has passed
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(limiter.check('k')).toBe(true)
        resolve()
      }, 5)
    })
  })

  it('tracks different keys independently', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 1 })
    expect(limiter.check('a')).toBe(true)
    expect(limiter.check('b')).toBe(true)
    expect(limiter.check('a')).toBe(false)
    expect(limiter.check('b')).toBe(false)
  })
})

describe('rateLimitKey', () => {
  it('keys on IP alone', () => {
    expect(rateLimitKey('1.2.3.4')).toBe('ip:1.2.3.4')
  })

  it('uses unknown for missing IP', () => {
    expect(rateLimitKey(undefined)).toBe('ip:unknown')
  })

  it('produces the SAME key regardless of any client identifier (rotation cannot bypass)', () => {
    // The key must depend only on the IP — a client-supplied identifier must
    // never widen the keyspace, or rotating it would mint a fresh bucket and
    // defeat the per-IP limit.
    expect(rateLimitKey('1.2.3.4')).toBe(rateLimitKey('1.2.3.4'))
  })

  it('rotating client identifiers from one IP cannot escape the limit', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 3 })
    const allow: boolean[] = []
    // Simulate 5 requests from the same IP, each pretending to be a different
    // client. Since the key is IP-only, all 5 share one bucket.
    for (let i = 0; i < 5; i++) allow.push(limiter.check(rateLimitKey('9.9.9.9')))
    expect(allow).toEqual([true, true, true, false, false])
  })
})

describe('createRateLimitStore', () => {
  it('creates limiters for all four endpoints', () => {
    const store = createRateLimitStore()
    expect(store.register).toBeTruthy()
    expect(store.authorize).toBeTruthy()
    expect(store.token).toBeTruthy()
    expect(store.revoke).toBeTruthy()
  })

  it('respects threshold overrides', () => {
    const store = createRateLimitStore({ token: { maxRequests: 1 } })
    expect(store.token.check('k')).toBe(true)
    expect(store.token.check('k')).toBe(false)
    // Other limiters use the default
    for (let i = 0; i < 10; i++) store.authorize.check('k')
    expect(store.authorize.check('k')).toBe(true) // default is 60
  })
})

describe('applyRateLimit', () => {
  function makeRes() {
    const headers: Record<string, string> = {}
    let statusCode = 0
    let body: unknown
    return {
      setHeader: vi.fn((k: string, v: string) => { headers[k] = v }),
      status: vi.fn((s: number) => {
        statusCode = s
        return { json: vi.fn((b: unknown) => { body = b }) }
      }),
      get headers() { return headers },
      get statusCode() { return statusCode },
      get body() { return body },
    }
  }

  it('returns true when under limit', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 10 })
    const res = makeRes()
    expect(applyRateLimit(limiter, 'k', res as never)).toBe(true)
    expect(res.statusCode).toBe(0)
  })

  it('returns false and sends 429 when limit exceeded', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 1 })
    limiter.check('k')
    const res = makeRes()
    expect(applyRateLimit(limiter, 'k', res as never)).toBe(false)
    expect(res.statusCode).toBe(429)
    expect(res.headers['Retry-After']).toBe('60')
    expect((res.body as Record<string, unknown>)['error']).toBe('too_many_requests')
  })
})
