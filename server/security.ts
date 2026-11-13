import type express from 'express'
import type { CorsOptions } from 'cors'
import dns from 'node:dns/promises'
import net from 'node:net'

export function securityHeadersMiddleware(_req: express.Request, res: express.Response, next: express.NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=()')
  res.setHeader('X-XSS-Protection', '0')
  next()
}

export function createCorsOptions(): CorsOptions {
  const envOrigins = (process.env.YANXIDAO_CORS_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

  const defaultAllowed = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:3001',
    'http://127.0.0.1:3001',
    'http://localhost:4173',
    'http://127.0.0.1:4173',
  ]

  const allowedSet = new Set([...defaultAllowed, ...envOrigins])

  return {
    origin(origin, callback) {
      // Allow same-origin / Electron / non-browser requests with no Origin header
      if (!origin || origin === 'null') {
        return callback(null, true)
      }
      if (origin.startsWith('app://') || origin.startsWith('file://') || allowedSet.has(origin)) {
        return callback(null, true)
      }
      // Allow any localhost/127.0.0.1 port in local desktop or dev mode
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
        return callback(null, true)
      }
      return callback(new Error(`CORS origin not allowed: ${origin}`))
    },
    credentials: true,
  }
}

interface RateBucket {
  count: number
  resetAt: number
}

export function createRateLimiter(options: {
  windowMs: number
  max: number
  message?: string
  keyFn?: (req: express.Request) => string
}) {
  const buckets = new Map<string, RateBucket>()

  // Periodic cleanup
  setInterval(() => {
    const now = Date.now()
    for (const [k, v] of buckets.entries()) {
      if (now > v.resetAt) buckets.delete(k)
    }
  }, Math.max(60000, options.windowMs)).unref()

  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const now = Date.now()
    const key = options.keyFn ? options.keyFn(req) : (req.ip || req.socket.remoteAddress || 'unknown')
    let bucket = buckets.get(key)
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 1, resetAt: now + options.windowMs }
      buckets.set(key, bucket)
      return next()
    }
    bucket.count += 1
    if (bucket.count > options.max) {
      const retrySec = Math.ceil((bucket.resetAt - now) / 1000)
      res.setHeader('Retry-After', String(Math.max(1, retrySec)))
      return res.status(429).json({
        error: options.message || `请求过于频繁，请 ${Math.max(1, retrySec)} 秒后再试`,
      })
    }
    next()
  }
}

// Account-level brute-force lockout for admin login
const adminFailMap = new Map<string, { failures: number; lockedUntil: number }>()

export function isAdminLoginLocked(username: string): number {
  const key = username.toLowerCase()
  const entry = adminFailMap.get(key)
  if (!entry) return 0
  if (Date.now() < entry.lockedUntil) {
    return Math.ceil((entry.lockedUntil - Date.now()) / 1000)
  }
  if (entry.lockedUntil > 0 && Date.now() >= entry.lockedUntil) {
    adminFailMap.delete(key)
  }
  return 0
}

export function recordAdminLoginFailure(username: string): void {
  const key = username.toLowerCase()
  const entry = adminFailMap.get(key) || { failures: 0, lockedUntil: 0 }
  entry.failures += 1
  if (entry.failures >= 5) {
    entry.lockedUntil = Date.now() + 15 * 60 * 1000 // 15 minutes
  }
  adminFailMap.set(key, entry)
}

export function clearAdminLoginFailures(username: string): void {
  adminFailMap.delete(username.toLowerCase())
}

function isPrivateOrReservedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number)
    if (parts.length !== 4) return true
    const [a, b] = parts
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true // Link-local & cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a >= 224) return true
    return false
  }
  if (net.isIPv6(ip)) {
    const norm = ip.toLowerCase()
    if (norm === '::1' || norm === '::' || norm.startsWith('fe80:') || norm.startsWith('fc') || norm.startsWith('fd')) {
      return true
    }
    if (norm.startsWith('::ffff:')) {
      return isPrivateOrReservedIp(norm.slice(7))
    }
    return false
  }
  return true
}

export async function assertSafeRemoteUrl(rawUrl: string): Promise<URL> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error('无效的远程同步 URL 格式')
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('仅支持 http 或 https 协议的远程同步地址')
  }

  if (process.env.YANXIDAO_ALLOW_PRIVATE_SYNC === 'true') {
    return parsed
  }

  const hostname = parsed.hostname.toLowerCase()
  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('出于安全防护，禁止同步本机或内网域名地址')
  }

  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) {
      throw new Error('出于安全防护，禁止同步内网、回环或保留 IP 地址')
    }
    return parsed
  }

  const resolved = await dns.lookup(hostname, { all: true })
  if (!resolved || resolved.length === 0) {
    throw new Error('无法解析远程同步域名')
  }
  for (const addr of resolved) {
    if (isPrivateOrReservedIp(addr.address)) {
      throw new Error('出于安全防护，远程域名解析至内网或保留 IP，已拦截请求')
    }
  }

  return parsed
}
