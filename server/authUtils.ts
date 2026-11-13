import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '..')
const DATA_DIR = process.env.YANXIDAO_DATA_DIR || path.join(PROJECT_ROOT, 'data')
const SECRETS_FILE = path.join(DATA_DIR, '.secrets.json')

function loadOrCreateSecrets(): { userSecret: string; adminSecret: string } {
  const envUser = process.env.YANXIDAO_USER_SECRET?.trim()
  const envAdmin = process.env.YANXIDAO_ADMIN_SECRET?.trim()
  if (envUser && envAdmin) {
    return { userSecret: envUser, adminSecret: envAdmin }
  }

  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true })
    }
    if (fs.existsSync(SECRETS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8'))
      if (parsed?.userSecret && parsed?.adminSecret) {
        return {
          userSecret: envUser || parsed.userSecret,
          adminSecret: envAdmin || parsed.adminSecret,
        }
      }
    }
  } catch {}

  const generated = {
    userSecret: envUser || crypto.randomBytes(32).toString('hex'),
    adminSecret: envAdmin || crypto.randomBytes(32).toString('hex'),
  }
  try {
    fs.writeFileSync(SECRETS_FILE, JSON.stringify(generated, null, 2), { mode: 0o600 })
  } catch {}
  return generated
}

const secrets = loadOrCreateSecrets()
const USER_TOKEN_SECRET = secrets.userSecret
const ADMIN_TOKEN_SECRET = secrets.adminSecret

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const derived = crypto.scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${derived}`
}

export function verifyPassword(password: string, storedHash?: string | null): boolean {
  if (!storedHash || !storedHash.includes(':')) return false
  const [salt, keyHex] = storedHash.split(':')
  if (!salt || !keyHex) return false
  try {
    const derived = crypto.scryptSync(password, salt, 64)
    const keyBuf = Buffer.from(keyHex, 'hex')
    if (derived.length !== keyBuf.length) return false
    return crypto.timingSafeEqual(derived, keyBuf)
  } catch {
    return false
  }
}

export function generateTempPassword8(): string {
  // Exclude confusing characters: 0, O, o, 1, l, I
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  let pwd = ''
  const bytes = crypto.randomBytes(8)
  for (let i = 0; i < 8; i++) {
    pwd += chars[bytes[i] % chars.length]
  }
  return pwd
}

export function generateResetToken(): string {
  return crypto.randomBytes(24).toString('hex')
}

export interface TokenPayload {
  sub: string
  scope: 'user' | 'admin'
  username?: string
  exp: number
}

function signPayload(payload: TokenPayload, secret: string): string {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url')
  return `${data}.${sig}`
}

function verifyToken(token: string, expectedScope: 'user' | 'admin', secret: string): TokenPayload | null {
  if (!token || !token.includes('.')) return null
  const [data, sig] = token.split('.')
  if (!data || !sig) return null
  const expectedSig = crypto.createHmac('sha256', secret).update(data).digest('base64url')
  try {
    const sigBuf = Buffer.from(sig)
    const expBuf = Buffer.from(expectedSig)
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null
    }
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as TokenPayload
    if (payload.scope !== expectedScope) return null
    if (!payload.exp || Date.now() > payload.exp) return null
    return payload
  } catch {
    return null
  }
}

export function signUserToken(userId: string, ttlDays = 30): string {
  return signPayload(
    { sub: userId, scope: 'user', exp: Date.now() + ttlDays * 24 * 60 * 60 * 1000 },
    USER_TOKEN_SECRET
  )
}

export function verifyUserToken(token: string): TokenPayload | null {
  return verifyToken(token, 'user', USER_TOKEN_SECRET)
}

export function signAdminToken(adminId: string, username: string, ttlHours = 24): string {
  return signPayload(
    { sub: adminId, username, scope: 'admin', exp: Date.now() + ttlHours * 60 * 60 * 1000 },
    ADMIN_TOKEN_SECRET
  )
}

export function verifyAdminToken(token: string): TokenPayload | null {
  return verifyToken(token, 'admin', ADMIN_TOKEN_SECRET)
}
