import express from 'express'
import cors from 'cors'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type { Server } from 'node:http'
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import {
  pool,
  initDatabase,
  exportCourseBundle,
  importCourseBundle,
  getSystemMeta,
  setSystemMeta,
  DB_FILE_PATH,
  DB_MODE,
} from './db'
import {
  securityHeadersMiddleware,
  createCorsOptions,
  createRateLimiter,
  isAdminLoginLocked,
  recordAdminLoginFailure,
  clearAdminLoginFailures,
  assertSafeRemoteUrl,
} from './security'
import { ImporterService } from '../src/services/importerService'
import {
  hashPassword,
  verifyPassword,
  generateTempPassword8,
  generateResetToken,
  signUserToken,
  verifyUserToken,
  signAdminToken,
  verifyAdminToken,
  normalizeClientType,
  type ClientType,
} from './authUtils'
import { getSmtpConfig, saveSmtpConfig, sendAccountProvisionEmail, sendSystemEmail } from './emailService'
import {
  DAILY_EXP_CAP,
  VIP_EXP_MULTIPLIER,
  VIP_TYPE_INFO,
  calculateVipExpiration,
  formatLocalDateTime,
  getHigherVipTypes,
  getLevelInfo,
  getTodayDateStr,
  getVipRemainingDays,
  isVipActive,
  type VipType,
} from '@yanxidao/shared'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '..')

export const app = express()
const port = Number(process.env.PORT || 3001)
const importerService = new ImporterService()

app.use(securityHeadersMiddleware)
app.use(cors(createCorsOptions()))
// Tighten global JSON body limit to 2mb; large course bundle imports use 50mb explicitly
app.use((req, res, next) => {
  if (req.path === '/api/sync/import' || /^\/api\/lessons\/[^/]+\/import$/.test(req.path)) {
    return express.json({ limit: '50mb' })(req, res, next)
  }
  return express.json({ limit: '2mb' })(req, res, next)
})

const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: '登录或验证请求过于频繁，请 15 分钟后再试',
})

const adminAuthRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: '后台登录尝试过于频繁，请稍后再试',
})

// Health Check
app.get('/api/health', async (_, res) => {
  try {
    const [rows] = await pool.query('SELECT 1 as val;')
    res.json({ status: 'ok', database: 'connected', test: rows })
  } catch (err: unknown) {
    res.status(500).json({ status: 'error', message: (err as Error).message })
  }
})

// ==================== Auth & Progression Helpers ====================
function getAuthenticatedUserPayload(req: express.Request) {
  const authHeader = req.headers.authorization || ''
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim()
    const payload = verifyUserToken(token)
    if (payload?.sub) return payload
  }
  return null
}

function getAuthenticatedUserId(req: express.Request): string | null {
  return getAuthenticatedUserPayload(req)?.sub || null
}

async function issueUserSessionToken(userId: string, clientType: ClientType, deviceInfo = ''): Promise<string> {
  const sid = crypto.randomBytes(16).toString('hex')
  const slotId = `${userId}:${clientType}`
  const nowStr = formatLocalDateTime(new Date())
  await pool.query(
    `INSERT INTO user_sessions (id, user_id, client_type, session_id, device_info, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE session_id = VALUES(session_id), device_info = VALUES(device_info), updated_at = VALUES(updated_at);`,
    [slotId, userId, clientType, sid, deviceInfo.slice(0, 160), nowStr]
  )
  return signUserToken(userId, clientType, sid)
}

async function recordIdempotentSyncEvent(eventId: string, userId: string, clientType: string): Promise<boolean> {
  const cleanId = String(eventId || '').trim().slice(0, 128)
  if (!cleanId) return true
  try {
    const [existing] = await pool.query<any[]>('SELECT id FROM sync_events WHERE id = ? LIMIT 1;', [cleanId])
    if (existing.length > 0) return false
    await pool.query(
      'INSERT INTO sync_events (id, user_id, client_type) VALUES (?, ?, ?);',
      [cleanId, userId, clientType || 'web']
    )
    return true
  } catch {
    return false
  }
}

async function requireUser(req: express.Request, res: express.Response, next: express.NextFunction) {
  const payload = getAuthenticatedUserPayload(req)
  if (!payload?.sub) {
    return res.status(401).json({ error: '请先登录账号后再执行此操作' })
  }
  if (payload.sid && payload.clientType) {
    try {
      const slotId = `${payload.sub}:${payload.clientType}`
      const [rows] = await pool.query<any[]>('SELECT session_id FROM user_sessions WHERE id = ? LIMIT 1;', [slotId])
      if (rows.length === 0) {
        return res.status(401).json({ error: '登录会话已失效，请重新登录', code: 'SESSION_EXPIRED' })
      }
      if (rows[0].session_id !== payload.sid) {
        const label = payload.clientType === 'desktop' ? '桌面端' : '网页端'
        return res.status(401).json({
          error: `您的账号已在另一台${label}登录，当前会话已下线`,
          code: 'SESSION_KICKED',
          clientType: payload.clientType,
        })
      }
    } catch (err: unknown) {
      return res.status(500).json({ error: (err as Error).message })
    }
  }
  ;(req as any).userId = payload.sub
  ;(req as any).clientType = payload.clientType || 'web'
  ;(req as any).sessionId = payload.sid || ''
  next()
}

function resolveUserIdFromReq(req: express.Request): string {
  return getAuthenticatedUserId(req) || ''
}

function getClientOrigin(req: express.Request): string {
  const origin = req.headers.origin
  if (origin && typeof origin === 'string') return origin
  const host = req.headers.host || 'localhost:5173'
  const proto = req.protocol || 'http'
  return `${proto}://${host}`
}

async function syncAndFormatUserProfile(r: any) {
  const todayStr = getTodayDateStr()
  let needsUpdate = false
  const updates: string[] = []
  const params: any[] = []

  // 1. Daily reset check (quota & today stats)
  let todayStudySeconds = Number(r.today_study_seconds || 0)
  let todaySentenceCount = Number(r.today_sentence_count || 0)
  let todayExp = Number(r.today_exp || 0)
  let todayUsedSeconds = Number(r.today_used_seconds || 0)

  if (r.last_quota_date !== todayStr) {
    todayUsedSeconds = 0
    todayStudySeconds = 0
    todaySentenceCount = 0
    todayExp = 0
    updates.push('today_used_seconds = 0', 'today_study_seconds = 0', 'today_sentence_count = 0', 'today_exp = 0', 'last_quota_date = ?')
    params.push(todayStr)
    needsUpdate = true
  }

  // 2. VIP expiration check & auto-downgrade (preserving level & grayed badge)
  let vipType = (r.vip_type || 'free') as VipType
  let vipExpireAt = r.vip_expire_at || null
  let role = r.role || '普通用户'
  let hasEverVip = Boolean(r.has_ever_vip)
  let lastVipType = (r.last_vip_type || null) as VipType | null

  if (vipType !== 'free' && vipType !== 'vip_lifetime') {
    if (!isVipActive(vipType, vipExpireAt)) {
      hasEverVip = true
      lastVipType = vipType
      vipType = 'free'
      role = '普通用户'
      updates.push("vip_type = 'free'", "role = '普通用户'", 'has_ever_vip = 1', 'last_vip_type = ?')
      params.push(lastVipType)
      needsUpdate = true
    }
  }

  // 3. Sync level from EXP
  const exp = Number(r.exp || 0)
  const levelInfo = getLevelInfo(exp)
  if (Number(r.level || 1) !== levelInfo.level) {
    updates.push('level = ?')
    params.push(levelInfo.level)
    needsUpdate = true
  }

  if (needsUpdate) {
    params.push(r.id)
    await pool.query(`UPDATE user_profile SET ${updates.join(', ')} WHERE id = ?;`, params)
  }

  const activeVip = isVipActive(vipType, vipExpireAt)
  const remainingDays = getVipRemainingDays(vipType, vipExpireAt)

  return {
    id: r.id,
    nickname: r.nickname,
    avatar: r.avatar,
    role,
    email: r.email || '',
    phone: r.phone || '',
    status: r.status || 'active',
    totalStudySeconds: Number(r.total_study_seconds || 0),
    todayStudySeconds,
    monthStudySeconds: Number(r.month_study_seconds || 0),
    totalSentenceCount: Number(r.total_sentence_count || 0),
    todaySentenceCount,
    continuousDays: Number(r.continuous_days || 0),
    lastCheckinDate: r.last_checkin_date || null,
    hasCheckedInToday: r.last_checkin_date === todayStr,
    exp,
    level: levelInfo.level,
    todayExp,
    vipType,
    vipExpireAt,
    hasEverVip,
    lastVipType,
    todayUsedSeconds,
    mustChangePassword: Boolean(r.must_change_password),
    isVipActive: activeVip,
    vipRemainingDays: remainingDays,
    dailyQuotaSeconds: levelInfo.dailyQuotaSeconds,
  }
}

async function logAdminAudit(adminUsername: string, action: string, targetUserId = '', targetEmail = '', details = '') {
  try {
    const id = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    await pool.query(
      `INSERT INTO admin_audit_logs (id, admin_username, action, target_user_id, target_email, details) VALUES (?, ?, ?, ?, ?, ?);`,
      [id, adminUsername, action, targetUserId, targetEmail, details]
    )
  } catch (err) {
    console.warn('[AuditLog] Failed to insert:', err)
  }
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const headerToken = (req.headers['x-admin-token'] as string) || ''
  const authHeader = req.headers.authorization || ''
  const token = headerToken || (authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '')
  const payload = verifyAdminToken(token)
  if (!payload) {
    return res.status(401).json({ error: '管理员登录已过期或未授权，请重新登录后台' })
  }
  ;(req as any).admin = payload
  next()
}

// Protect all /api/admin/* endpoints except /api/admin/login
app.use('/api/admin', (req, res, next) => {
  if (req.path === '/login') return next()
  return requireAdmin(req, res, next)
})

// ==================== Frontend User Authentication ====================
app.post('/api/auth/login', authRateLimiter, async (req, res) => {
  try {
    const { email, password } = req.body
    if (!email || !password) {
      return res.status(400).json({ error: '请输入邮箱和密码' })
    }
    const cleanEmail = String(email).trim().toLowerCase()
    const [rows] = await pool.query<any[]>('SELECT * FROM user_profile WHERE LOWER(email) = ? LIMIT 1;', [cleanEmail])
    if (rows.length === 0) {
      return res.status(401).json({ error: '邮箱或密码错误' })
    }
    const user = rows[0]
    if (user.status === 'disabled') {
      return res.status(403).json({ error: '您的账号已被管理员停用，如有疑问请联系管理员' })
    }
    if (!verifyPassword(String(password), user.password_hash)) {
      return res.status(401).json({ error: '邮箱或密码错误' })
    }

    const clientType = normalizeClientType(req.body?.clientType || req.headers['x-client-type'])
    const formatted = await syncAndFormatUserProfile(user)
    const token = await issueUserSessionToken(user.id, clientType, String(req.headers['user-agent'] || ''))
    res.json({
      success: true,
      token,
      clientType,
      mustChangePassword: Boolean(user.must_change_password),
      user: formatted,
    })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.post('/api/auth/demo-login', async (req, res) => {
  try {
    const [rows] = await pool.query<any[]>("SELECT * FROM user_profile WHERE id = '8723192' LIMIT 1;")
    if (rows.length === 0) return res.status(404).json({ error: '默认体验账号不存在' })
    const user = rows[0]
    if (user.status === 'disabled') {
      return res.status(403).json({ error: '该账号已被管理员停用' })
    }
    const clientType = normalizeClientType(req.body?.clientType || req.headers['x-client-type'])
    const formatted = await syncAndFormatUserProfile(user)
    const token = await issueUserSessionToken(user.id, clientType, String(req.headers['user-agent'] || ''))
    res.json({ success: true, token, clientType, user: formatted })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.post('/api/auth/logout', requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string
    const clientType = normalizeClientType((req as any).clientType)
    const sid = String((req as any).sessionId || '')
    const slotId = `${userId}:${clientType}`
    if (sid) {
      await pool.query('DELETE FROM user_sessions WHERE id = ? AND session_id = ?;', [slotId, sid])
    } else {
      await pool.query('DELETE FROM user_sessions WHERE id = ?;', [slotId])
    }
    res.json({ success: true })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.post('/api/auth/change-password', requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string
    const { oldPassword, newPassword } = req.body
    if (!newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ error: '新密码长度不能少于 6 位' })
    }
    const [rows] = await pool.query<any[]>('SELECT * FROM user_profile WHERE id = ? LIMIT 1;', [userId])
    if (rows.length === 0) return res.status(404).json({ error: '用户不存在' })
    const user = rows[0]

    // If not forced first-login change, verify oldPassword if provided or require it
    if (!user.must_change_password) {
      if (!oldPassword || !verifyPassword(String(oldPassword), user.password_hash)) {
        return res.status(400).json({ error: '原密码不正确' })
      }
    }

    await pool.query(
      'UPDATE user_profile SET password_hash = ?, must_change_password = 0, reset_token = NULL, reset_token_expires = NULL WHERE id = ?;',
      [hashPassword(String(newPassword)), userId]
    )
    res.json({ success: true, message: '密码修改成功' })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.get('/api/auth/verify-reset-token', async (req, res) => {
  try {
    const token = String(req.query.token || '').trim()
    if (!token) return res.status(400).json({ valid: false, error: '无效的链接参数' })
    const [rows] = await pool.query<any[]>('SELECT id, email, nickname, reset_token_expires, status FROM user_profile WHERE reset_token = ? LIMIT 1;', [token])
    if (rows.length === 0) {
      return res.json({ valid: false, error: '改密链接无效或已被使用' })
    }
    const u = rows[0]
    if (u.status === 'disabled') {
      return res.json({ valid: false, error: '您的账号已被管理员停用' })
    }
    if (!u.reset_token_expires || new Date(u.reset_token_expires).getTime() < Date.now()) {
      return res.json({ valid: false, error: '改密链接已过期，请联系管理员重新发送' })
    }
    res.json({ valid: true, email: u.email, nickname: u.nickname })
  } catch (err: unknown) {
    res.status(500).json({ valid: false, error: (err as Error).message })
  }
})

app.post('/api/auth/reset-by-token', authRateLimiter, async (req, res) => {
  try {
    const { token, newPassword } = req.body
    if (!token || !newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ error: '请输入至少 6 位的新密码' })
    }
    const [rows] = await pool.query<any[]>('SELECT * FROM user_profile WHERE reset_token = ? LIMIT 1;', [String(token).trim()])
    if (rows.length === 0) {
      return res.status(400).json({ error: '改密链接无效或已被使用' })
    }
    const user = rows[0]
    if (user.status === 'disabled') {
      return res.status(403).json({ error: '您的账号已被管理员停用' })
    }
    if (!user.reset_token_expires || new Date(user.reset_token_expires).getTime() < Date.now()) {
      return res.status(400).json({ error: '改密链接已过期，请联系管理员重新发送' })
    }

    await pool.query(
      'UPDATE user_profile SET password_hash = ?, must_change_password = 0, reset_token = NULL, reset_token_expires = NULL WHERE id = ?;',
      [hashPassword(String(newPassword)), user.id]
    )
    const clientType = normalizeClientType(req.body?.clientType || req.headers['x-client-type'])
    const [updatedRows] = await pool.query<any[]>('SELECT * FROM user_profile WHERE id = ? LIMIT 1;', [user.id])
    const formatted = await syncAndFormatUserProfile(updatedRows[0])
    const authToken = await issueUserSessionToken(user.id, clientType, String(req.headers['user-agent'] || ''))
    res.json({ success: true, token: authToken, clientType, user: formatted, message: '密码设置成功，已自动登录' })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.post('/api/auth/forgot-password', authRateLimiter, async (req, res) => {
  try {
    const { email } = req.body
    if (!email) return res.status(400).json({ error: '请输入注册邮箱' })
    const cleanEmail = String(email).trim().toLowerCase()
    const [rows] = await pool.query<any[]>('SELECT * FROM user_profile WHERE LOWER(email) = ? LIMIT 1;', [cleanEmail])
    if (rows.length === 0) {
      return res.status(404).json({ error: '未找到该邮箱对应的账号' })
    }
    const user = rows[0]
    if (user.status === 'disabled') {
      return res.status(403).json({ error: '您的账号已被管理员停用，无法重置密码' })
    }
    const tempPwd = generateTempPassword8()
    const resetToken = generateResetToken()
    const expires = formatLocalDateTime(new Date(Date.now() + 24 * 60 * 60 * 1000))
    await pool.query(
      'UPDATE user_profile SET password_hash = ?, must_change_password = 1, reset_token = ?, reset_token_expires = ? WHERE id = ?;',
      [hashPassword(tempPwd), resetToken, expires, user.id]
    )
    const resetLink = `${getClientOrigin(req)}/change-password?token=${resetToken}`
    const emailRes = await sendAccountProvisionEmail({
      email: user.email,
      nickname: user.nickname,
      tempPassword: tempPwd,
      resetLink,
      vipType: user.vip_type || 'free',
      vipExpireAt: user.vip_expire_at,
      isReset: true,
    })
    res.json({
      success: true,
      emailStatus: emailRes.status,
      message: emailRes.status === 'sent' ? '重置密码邮件已发送至您的邮箱' : '已生成重置凭证（本地演示模式未配置SMTP，请联系管理员获取）',
    })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ==================== User & Purchases ====================
app.get('/api/user/profile', requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string
    const [rows] = await pool.query<any[]>('SELECT * FROM user_profile WHERE id = ? LIMIT 1;', [userId])
    if (rows.length === 0) return res.status(404).json({ message: 'User not found' })
    const r = rows[0]
    if (r.status === 'disabled') {
      return res.status(403).json({ error: '您的账号已被管理员停用', disabled: true })
    }
    const formatted = await syncAndFormatUserProfile(r)
    res.json(formatted)
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// Daily Check-in Endpoint
app.post('/api/user/checkin', requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string
    const [rows] = await pool.query<any[]>('SELECT * FROM user_profile WHERE id = ? LIMIT 1;', [userId])
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' })
    const user = rows[0]

    const today = new Date()
    const todayStr = getTodayDateStr(today)
    const lastDateStr = user.last_checkin_date

    if (lastDateStr === todayStr) {
      return res.json({
        success: true,
        alreadyCheckedIn: true,
        continuousDays: user.continuous_days || 1,
        lastCheckinDate: todayStr,
        hasCheckedInToday: true,
        expGained: 0,
        message: '今日已完成打卡',
      })
    }

    let newStreak = 1
    if (lastDateStr) {
      const yesterday = new Date(today)
      yesterday.setDate(yesterday.getDate() - 1)
      const yesterdayStr = getTodayDateStr(yesterday)
      if (lastDateStr === yesterdayStr) {
        newStreak = (user.continuous_days || 0) + 1
      } else {
        newStreak = 1
      }
    } else {
      newStreak = (user.continuous_days && user.continuous_days > 0) ? user.continuous_days : 1
    }

    // Calculate check-in EXP (+50 base + milestone bonuses)
    let expBonus = 50
    let milestoneText = ''
    if (newStreak === 7) { expBonus += 100; milestoneText = '（含连续7天里程碑 +100 EXP）' }
    else if (newStreak === 14) { expBonus += 250; milestoneText = '（含连续14天里程碑 +250 EXP）' }
    else if (newStreak === 30) { expBonus += 600; milestoneText = '（含连续30天里程碑 +600 EXP）' }
    else if (newStreak === 100) { expBonus += 2000; milestoneText = '（含连续100天里程碑 +2000 EXP）' }

    const oldExp = Number(user.exp || 0)
    const newExp = oldExp + expBonus
    const oldLevel = getLevelInfo(oldExp).level
    const newLevelInfo = getLevelInfo(newExp)

    await pool.query(
      'UPDATE user_profile SET continuous_days = ?, last_checkin_date = ?, exp = ?, level = ? WHERE id = ?;',
      [newStreak, todayStr, newExp, newLevelInfo.level, userId]
    )

    res.json({
      success: true,
      alreadyCheckedIn: false,
      continuousDays: newStreak,
      lastCheckinDate: todayStr,
      hasCheckedInToday: true,
      expGained: expBonus,
      exp: newExp,
      level: newLevelInfo.level,
      leveledUp: newLevelInfo.level > oldLevel,
      message: `打卡成功！连续 ${newStreak} 天，获得 +${expBonus} EXP${milestoneText}`,
    })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.put('/api/user/profile', requireUser, async (req, res) => {
  try {
    const { nickname, avatar, addStudySeconds, addSentenceCount, eventId } = req.body
    const targetUserId = (req as any).userId as string
    const clientType = String((req as any).clientType || 'web')
    const [rows] = await pool.query<any[]>('SELECT * FROM user_profile WHERE id = ? LIMIT 1;', [targetUserId])
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' })
    const user = rows[0]

    // Ensure daily quota / VIP expiration is synced first
    const synced = await syncAndFormatUserProfile(user)

    if (eventId) {
      const isFresh = await recordIdempotentSyncEvent(String(eventId), targetUserId, clientType)
      if (!isFresh) {
        return res.json({
          success: true,
          deduplicated: true,
          expGained: 0,
          leveledUp: false,
          newLevel: synced.level,
          profile: synced,
        })
      }
    }

    const updates: string[] = []
    const values: any[] = []

    if (nickname) {
      updates.push('nickname = ?')
      values.push(nickname)
    }
    if (avatar) {
      updates.push('avatar = ?')
      values.push(avatar)
    }

    let rawExpGain = 0
    if (addStudySeconds && Number(addStudySeconds) > 0) {
      const secs = Math.min(300, Math.floor(Number(addStudySeconds)))
      updates.push('total_study_seconds = total_study_seconds + ?')
      updates.push('today_study_seconds = today_study_seconds + ?')
      updates.push('month_study_seconds = month_study_seconds + ?')
      values.push(secs, secs, secs)

      if (!synced.isVipActive) {
        updates.push('today_used_seconds = today_used_seconds + ?')
        values.push(secs)
      }

      // 10 EXP per minute -> 1 EXP per 6 seconds
      const oldTotal = synced.totalStudySeconds
      const newTotal = oldTotal + secs
      rawExpGain += Math.floor(newTotal / 6) - Math.floor(oldTotal / 6)
    }

    if (addSentenceCount && Number(addSentenceCount) > 0) {
      const cnt = Math.min(20, Math.floor(Number(addSentenceCount)))
      updates.push('total_sentence_count = total_sentence_count + ?')
      updates.push('today_sentence_count = today_sentence_count + ?')
      values.push(cnt, cnt)
      rawExpGain += cnt * 2
    }

    let actualExpGain = 0
    let leveledUp = false
    let newLevel = synced.level

    if (rawExpGain > 0) {
      const multiplied = synced.isVipActive ? Math.round(rawExpGain * VIP_EXP_MULTIPLIER) : rawExpGain
      const remainingCap = Math.max(0, DAILY_EXP_CAP - (synced.todayExp || 0))
      actualExpGain = Math.min(multiplied, remainingCap)
      if (actualExpGain > 0) {
        const nextExp = synced.exp + actualExpGain
        const nextLevelInfo = getLevelInfo(nextExp)
        leveledUp = nextLevelInfo.level > synced.level
        newLevel = nextLevelInfo.level
        updates.push('exp = exp + ?', 'today_exp = today_exp + ?', 'level = ?')
        values.push(actualExpGain, actualExpGain, newLevel)
      }
    }

    if (updates.length > 0) {
      values.push(targetUserId)
      await pool.query(`UPDATE user_profile SET ${updates.join(', ')} WHERE id = ?;`, values)
    }

    const [afterRows] = await pool.query<any[]>('SELECT * FROM user_profile WHERE id = ? LIMIT 1;', [targetUserId])
    const updatedProfile = afterRows.length > 0 ? await syncAndFormatUserProfile(afterRows[0]) : synced

    res.json({
      success: true,
      expGained: actualExpGain,
      leveledUp,
      newLevel,
      profile: updatedProfile,
    })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ==================== Multi-Client Incremental State Sync ====================
app.get('/api/user/sync', requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string
    const [uRows] = await pool.query<any[]>('SELECT * FROM user_profile WHERE id = ? LIMIT 1;', [userId])
    if (uRows.length === 0) return res.status(404).json({ error: 'User not found' })
    const profile = await syncAndFormatUserProfile(uRows[0])

    const [progressRows] = await pool.query<any[]>(
      'SELECT * FROM user_course_progress WHERE user_id = ? ORDER BY last_practiced_at DESC;',
      [userId]
    )
    const [favRows] = await pool.query<any[]>(
      'SELECT course_id FROM user_favorites WHERE user_id = ?;',
      [userId]
    )

    res.json({
      serverTime: formatLocalDateTime(new Date()),
      profile,
      progressList: progressRows.map(r => ({
        courseId: r.course_id,
        lessonId: r.lesson_id,
        sentenceIndex: Number(r.sentence_index || 0),
        totalSentences: Number(r.total_sentences || 0),
        progressPercent: Number(r.progress_percent || 0),
        studySeconds: Number(r.study_seconds || 0),
        lastPracticedAt: r.last_practiced_at,
      })),
      favoriteCourseIds: favRows.map(r => r.course_id),
    })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.post('/api/user/sync', requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string
    const clientType = String((req as any).clientType || 'web')
    const events = Array.isArray(req.body?.events) ? req.body.events.slice(0, 100) : []
    let appliedCount = 0
    let deduplicatedCount = 0

    for (const ev of events) {
      const eventId = String(ev?.eventId || '').trim()
      if (!eventId) continue
      const isFresh = await recordIdempotentSyncEvent(eventId, userId, clientType)
      if (!isFresh) {
        deduplicatedCount++
        continue
      }

      const [uRows] = await pool.query<any[]>('SELECT * FROM user_profile WHERE id = ? LIMIT 1;', [userId])
      if (uRows.length === 0) break
      const synced = await syncAndFormatUserProfile(uRows[0])

      const secs = ev.addStudySeconds && Number(ev.addStudySeconds) > 0 ? Math.min(300, Math.floor(Number(ev.addStudySeconds))) : 0
      const cnt = ev.addSentenceCount && Number(ev.addSentenceCount) > 0 ? Math.min(20, Math.floor(Number(ev.addSentenceCount))) : 0
      if (secs > 0 || cnt > 0) {
        let rawExp = 0
        const updates: string[] = []
        const vals: any[] = []
        if (secs > 0) {
          updates.push('total_study_seconds = total_study_seconds + ?', 'today_study_seconds = today_study_seconds + ?', 'month_study_seconds = month_study_seconds + ?')
          vals.push(secs, secs, secs)
          if (!synced.isVipActive) {
            updates.push('today_used_seconds = today_used_seconds + ?')
            vals.push(secs)
          }
          rawExp += Math.floor((synced.totalStudySeconds + secs) / 6) - Math.floor(synced.totalStudySeconds / 6)
        }
        if (cnt > 0) {
          updates.push('total_sentence_count = total_sentence_count + ?', 'today_sentence_count = today_sentence_count + ?')
          vals.push(cnt, cnt)
          rawExp += cnt * 2
        }
        if (rawExp > 0) {
          const multiplied = synced.isVipActive ? Math.round(rawExp * VIP_EXP_MULTIPLIER) : rawExp
          const gain = Math.min(multiplied, Math.max(0, DAILY_EXP_CAP - (synced.todayExp || 0)))
          if (gain > 0) {
            const nextLevel = getLevelInfo(synced.exp + gain).level
            updates.push('exp = exp + ?', 'today_exp = today_exp + ?', 'level = ?')
            vals.push(gain, gain, nextLevel)
          }
        }
        if (updates.length > 0) {
          vals.push(userId)
          await pool.query(`UPDATE user_profile SET ${updates.join(', ')} WHERE id = ?;`, vals)
        }
      }
      appliedCount++
    }

    const [afterRows] = await pool.query<any[]>('SELECT * FROM user_profile WHERE id = ? LIMIT 1;', [userId])
    const profile = afterRows.length > 0 ? await syncAndFormatUserProfile(afterRows[0]) : null
    res.json({
      success: true,
      serverTime: formatLocalDateTime(new Date()),
      appliedCount,
      deduplicatedCount,
      profile,
    })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ==================== User Settings & Navigation Menu ====================
app.get('/api/user/settings', async (_, res) => {
  try {
    const [rows] = await pool.query<any[]>('SELECT settings_json FROM user_profile WHERE id = \'8723192\' LIMIT 1;')
    if (rows.length === 0 || !rows[0].settings_json) {
      return res.json(null)
    }
    const settings = typeof rows[0].settings_json === 'string'
      ? JSON.parse(rows[0].settings_json)
      : rows[0].settings_json
    res.json(settings)
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.put('/api/user/settings', async (req, res) => {
  try {
    const settings = req.body
    await pool.query('UPDATE user_profile SET settings_json = ? WHERE id = \'8723192\';', [JSON.stringify(settings)])
    res.json({ success: true })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.get('/api/user/menu', async (_, res) => {
  try {
    const [rows] = await pool.query<any[]>('SELECT menu_config_json FROM user_profile WHERE id = \'8723192\' LIMIT 1;')
    if (rows.length === 0 || !rows[0].menu_config_json) {
      return res.json(null)
    }
    const menuConfig = typeof rows[0].menu_config_json === 'string'
      ? JSON.parse(rows[0].menu_config_json)
      : rows[0].menu_config_json
    res.json(menuConfig)
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.put('/api/user/menu', async (req, res) => {
  try {
    const menuConfig = req.body
    await pool.query('UPDATE user_profile SET menu_config_json = ? WHERE id = \'8723192\';', [JSON.stringify(menuConfig)])
    res.json({ success: true })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.get('/api/user/purchases', async (_, res) => {
  try {
    const [rows] = await pool.query<any[]>('SELECT * FROM purchase_records ORDER BY purchase_time DESC;')
    res.json(rows.map(r => ({
      id: r.id,
      orderNo: r.order_no,
      courseName: r.course_name,
      purchaseTime: r.purchase_time,
      amount: parseFloat(r.amount),
      status: r.status,
    })))
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ==================== User VIP Upgrade Applications ====================
function formatVipRequestRow(r: any) {
  return {
    id: r.id,
    userId: r.user_id,
    userEmail: r.user_email || '',
    userNickname: r.user_nickname || '',
    currentVipType: (r.current_vip_type || 'free') as VipType,
    targetVipType: r.target_vip_type as VipType,
    status: r.status as 'pending' | 'replied' | 'approved' | 'rejected',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function formatVipMessageRow(m: any) {
  return {
    id: m.id,
    requestId: m.request_id,
    senderRole: m.sender_role as 'user' | 'admin',
    senderName: m.sender_name || '',
    content: m.content,
    createdAt: m.created_at,
  }
}

app.get('/api/user/vip-requests', requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string
    const [uRows] = await pool.query<any[]>('SELECT * FROM user_profile WHERE id = ? LIMIT 1;', [userId])
    if (uRows.length === 0) return res.status(404).json({ error: '用户不存在' })
    const profile = await syncAndFormatUserProfile(uRows[0])
    const activeVip: VipType = profile?.isVipActive ? profile.vipType : 'free'
    const higherTypes = getHigherVipTypes(activeVip)

    const [reqRows] = await pool.query<any[]>(
      'SELECT * FROM vip_upgrade_requests WHERE user_id = ? ORDER BY updated_at DESC, created_at DESC;',
      [userId]
    )
    const requests = reqRows.map(formatVipRequestRow)

    const processedTypes = Array.from(
      new Set(
        requests
          .filter(r => r.status === 'approved' || r.status === 'rejected')
          .map(r => r.targetVipType)
      )
    )
    const openTypes = Array.from(
      new Set(
        requests
          .filter(r => r.status === 'pending' || r.status === 'replied')
          .map(r => r.targetVipType)
      )
    )

    const messagesMap: Record<string, any[]> = {}
    if (requests.length > 0) {
      const ids = requests.map(r => r.id)
      const placeholders = ids.map(() => '?').join(', ')
      const [msgRows] = await pool.query<any[]>(
        `SELECT * FROM vip_upgrade_messages WHERE request_id IN (${placeholders}) ORDER BY created_at ASC;`,
        ids
      )
      for (const m of msgRows) {
        const formatted = formatVipMessageRow(m)
        if (!messagesMap[formatted.requestId]) messagesMap[formatted.requestId] = []
        messagesMap[formatted.requestId].push(formatted)
      }
    }

    res.json({ requests, messagesMap, processedTypes, openTypes, higherTypes })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.post('/api/user/vip-requests', requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string
    const targetVipType = String(req.body?.targetVipType || '').trim() as VipType
    const note = String(req.body?.note || '').trim()

    if (!VIP_TYPE_INFO[targetVipType]) {
      return res.status(400).json({ error: '无效的目标会员类型' })
    }
    if (note.length > 1000) {
      return res.status(400).json({ error: '申请备注不能超过 1000 字' })
    }

    const [uRows] = await pool.query<any[]>('SELECT * FROM user_profile WHERE id = ? LIMIT 1;', [userId])
    if (uRows.length === 0) return res.status(404).json({ error: '用户不存在' })
    const profile = await syncAndFormatUserProfile(uRows[0])

    const currentVip: VipType = profile.isVipActive ? profile.vipType : 'free'
    const allowedHigher = getHigherVipTypes(currentVip)
    if (!allowedHigher.includes(targetVipType)) {
      return res.status(400).json({ error: '只能申请比当前会员等级更高的会员类型' })
    }

    // Reject duplicate / already-processed targetVipType for this user
    const [existing] = await pool.query<any[]>(
      `SELECT id, status FROM vip_upgrade_requests WHERE user_id = ? AND target_vip_type = ? LIMIT 1;`,
      [userId, targetVipType]
    )
    if (existing.length > 0) {
      return res.status(400).json({ error: '该会员类型已申请并处理或正在审核中，不可重复申请' })
    }

    const reqId = `vreq_${crypto.randomBytes(8).toString('hex')}`
    const nowStr = formatLocalDateTime(new Date())

    await pool.query(
      `INSERT INTO vip_upgrade_requests (id, user_id, user_email, user_nickname, current_vip_type, target_vip_type, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?);`,
      [reqId, userId, profile.email || '', profile.nickname || '', currentVip, targetVipType, nowStr, nowStr]
    )

    if (note) {
      const msgId = `vmsg_${crypto.randomBytes(8).toString('hex')}`
      await pool.query(
        `INSERT INTO vip_upgrade_messages (id, request_id, sender_role, sender_name, content, created_at)
         VALUES (?, ?, 'user', ?, ?, ?);`,
        [msgId, reqId, profile.nickname || profile.email || '用户', note, nowStr]
      )
    }

    res.json({
      success: true,
      request: {
        id: reqId,
        userId,
        userEmail: profile.email || '',
        userNickname: profile.nickname || '',
        currentVipType: currentVip,
        targetVipType,
        status: 'pending',
        createdAt: nowStr,
        updatedAt: nowStr,
      },
    })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.post('/api/user/vip-requests/:id/messages', requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string
    const requestId = req.params.id
    const content = String(req.body?.content || '').trim()
    if (!content) return res.status(400).json({ error: '回复内容不能为空' })
    if (content.length > 1500) return res.status(400).json({ error: '回复内容不能超过 1500 字' })

    const [rows] = await pool.query<any[]>(
      'SELECT * FROM vip_upgrade_requests WHERE id = ? AND user_id = ? LIMIT 1;',
      [requestId, userId]
    )
    if (rows.length === 0) return res.status(404).json({ error: '升级申请不存在' })

    const [userRows] = await pool.query<any[]>('SELECT nickname, email FROM user_profile WHERE id = ? LIMIT 1;', [userId])
    const senderName = userRows[0]?.nickname || userRows[0]?.email || '用户'
    const nowStr = formatLocalDateTime(new Date())
    const msgId = `vmsg_${crypto.randomBytes(8).toString('hex')}`

    await pool.query(
      `INSERT INTO vip_upgrade_messages (id, request_id, sender_role, sender_name, content, created_at)
       VALUES (?, ?, 'user', ?, ?, ?);`,
      [msgId, requestId, senderName, content, nowStr]
    )
    await pool.query('UPDATE vip_upgrade_requests SET updated_at = ? WHERE id = ?;', [nowStr, requestId])

    res.json({
      success: true,
      message: {
        id: msgId,
        requestId,
        senderRole: 'user',
        senderName,
        content,
        createdAt: nowStr,
      },
    })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ==================== User Course Learning Progress ====================
/**
 * Record / update learning progress when exiting or practicing
 */
app.post('/api/user/progress', requireUser, async (req, res) => {
  try {
    const {
      courseId,
      lessonId,
      sentenceIndex,
      totalSentences,
      progressPercent,
      courseTitle,
      lessonTitle,
      lessonNumber,
      studySeconds,
    } = req.body

    if (!courseId || !lessonId) {
      return res.status(400).json({ error: 'courseId and lessonId are required' })
    }

    const currentUserId = (req as any).userId as string
    const sIndex = sentenceIndex !== undefined ? Number(sentenceIndex) : 0
    const tSentences = totalSentences !== undefined ? Number(totalSentences) : 0
    const pPercent = progressPercent !== undefined ? Number(progressPercent) : 0
    const lNum = lessonNumber !== undefined ? Number(lessonNumber) : 1
    const sSecs = studySeconds !== undefined ? Number(studySeconds) : 0
    const progressId = `prog_${currentUserId}_${courseId}`

    await pool.query(`
      INSERT INTO user_course_progress (
        id, user_id, course_id, lesson_id, sentence_index, total_sentences,
        progress_percent, course_title, lesson_title, lesson_number, study_seconds, last_practiced_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        lesson_id = VALUES(lesson_id),
        sentence_index = VALUES(sentence_index),
        total_sentences = VALUES(total_sentences),
        progress_percent = VALUES(progress_percent),
        course_title = COALESCE(VALUES(course_title), course_title),
        lesson_title = COALESCE(VALUES(lesson_title), lesson_title),
        lesson_number = VALUES(lesson_number),
        study_seconds = GREATEST(COALESCE(study_seconds, 0), VALUES(study_seconds)),
        last_practiced_at = NOW();
    `, [
      progressId,
      currentUserId,
      courseId,
      lessonId,
      sIndex,
      tSentences,
      pPercent,
      courseTitle || null,
      lessonTitle || null,
      lNum,
      sSecs,
    ])

    res.json({ success: true, progressId })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

/**
 * Get progress for a specific course or user's progress list
 */
app.get('/api/user/progress', requireUser, async (req, res) => {
  try {
    const { courseId } = req.query
    const currentUserId = (req as any).userId as string

    if (courseId) {
      const [rows] = await pool.query<any[]>(
        'SELECT * FROM user_course_progress WHERE user_id = ? AND course_id = ? LIMIT 1;',
        [currentUserId, courseId]
      )
      if (rows.length === 0) return res.json(null)
      const r = rows[0]
      return res.json({
        id: r.id,
        userId: r.user_id,
        courseId: r.course_id,
        lessonId: r.lesson_id,
        sentenceIndex: r.sentence_index,
        totalSentences: r.total_sentences,
        progressPercent: r.progress_percent,
        courseTitle: r.course_title,
        lessonTitle: r.lesson_title,
        lessonNumber: r.lesson_number,
        studySeconds: r.study_seconds || 0,
        lastPracticedAt: r.last_practiced_at,
      })
    }

    const [rows] = await pool.query<any[]>(
      'SELECT * FROM user_course_progress WHERE user_id = ? ORDER BY last_practiced_at DESC;',
      [currentUserId]
    )
    res.json(rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      courseId: r.course_id,
      lessonId: r.lesson_id,
      sentenceIndex: r.sentence_index,
      totalSentences: r.total_sentences,
      progressPercent: r.progress_percent,
      courseTitle: r.course_title,
      lessonTitle: r.lesson_title,
      lessonNumber: r.lesson_number,
      studySeconds: r.study_seconds || 0,
      lastPracticedAt: r.last_practiced_at,
    })))
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

/**
 * Get user's most recent course/teaching practice record
 */
app.get('/api/user/progress/recent', requireUser, async (req, res) => {
  try {
    const currentUserId = (req as any).userId as string
    const [rows] = await pool.query<any[]>(
      'SELECT * FROM user_course_progress WHERE user_id = ? ORDER BY last_practiced_at DESC LIMIT 1;',
      [currentUserId]
    )
    if (rows.length === 0) return res.json(null)
    const r = rows[0]
    res.json({
      id: r.id,
      userId: r.user_id,
      courseId: r.course_id,
      lessonId: r.lesson_id,
      sentenceIndex: r.sentence_index,
      totalSentences: r.total_sentences,
      progressPercent: r.progress_percent,
      courseTitle: r.course_title,
      lessonTitle: r.lesson_title,
      lessonNumber: r.lesson_number,
      studySeconds: r.study_seconds || 0,
      lastPracticedAt: r.last_practiced_at,
    })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

/**
 * Get map of all course progress for the user
 */
app.get('/api/user/progress/all', requireUser, async (req, res) => {
  try {
    const currentUserId = (req as any).userId as string
    const [rows] = await pool.query<any[]>(
      'SELECT * FROM user_course_progress WHERE user_id = ?;',
      [currentUserId]
    )
    const map: Record<string, any> = {}
    rows.forEach(r => {
      map[r.course_id] = {
        lessonId: r.lesson_id,
        sentenceIndex: r.sentence_index,
        totalSentences: r.total_sentences,
        progressPercent: r.progress_percent,
        courseTitle: r.course_title,
        lessonTitle: r.lesson_title,
        lessonNumber: r.lesson_number,
        studySeconds: r.study_seconds || 0,
        lastPracticedAt: r.last_practiced_at,
      }
    })
    res.json(map)
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ==================== Courses & Teaching Materials ====================
app.get('/api/courses', async (req, res) => {
  try {
    const { type } = req.query
    const currentUserId = getAuthenticatedUserId(req) || ''
    let sql = `
      SELECT c.*, 
        (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id) AS real_lesson_count,
        EXISTS(SELECT 1 FROM user_favorites uf WHERE uf.course_id = c.id AND uf.user_id = ?) AS user_is_favorite
      FROM courses c
    `
    const params: any[] = [currentUserId]
    if (type) {
      sql += ' WHERE c.type = ?'
      params.push(type)
    }
    sql += ' ORDER BY COALESCE(c.order_num, 999) ASC, c.created_at DESC;'
    const [rows] = await pool.query<any[]>(sql, params)

    res.json(rows.map(r => ({
      id: r.id,
      type: r.type,
      title: r.title,
      instructor: {
        name: r.instructor_name,
        avatar: r.instructor_avatar || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + r.instructor_name,
      },
      lessonCount: Number(r.real_lesson_count || 0),
      completedLessons: r.completed_lessons,
      cover: r.cover,
      category: r.category,
      schoolLevel: r.school_level,
      grade: r.grade,
      orderNum: r.order_num != null ? Number(r.order_num) : 99,
      isFavorite: Boolean(r.user_is_favorite),
    })))
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.post('/api/courses', requireAdmin, async (req, res) => {
  try {
    const { type, title, instructorName, category, schoolLevel, grade, cover, lessonCount, orderNum } = req.body
    if (!title || !type) {
      return res.status(400).json({ error: 'Title and type are required' })
    }
    const id = `${type === 'teaching' ? 'tm' : 'c'}_${Date.now()}`
    const defaultCover = cover || 'https://images.unsplash.com/photo-1544717305-2782549b5136?w=400&q=80'
    const instructor = instructorName || '研习岛名师'
    const avatar = 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + instructor
    const initialLessonCount = lessonCount && Number(lessonCount) > 0 ? Number(lessonCount) : 0
    const orderNumber = orderNum !== undefined && orderNum !== null ? Number(orderNum) : 99

    await pool.query(`
      INSERT INTO courses (id, type, title, instructor_name, instructor_avatar, lesson_count, cover, category, school_level, grade, order_num)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `, [id, type, title, instructor, avatar, initialLessonCount, defaultCover, category || 'all', schoolLevel || 'all', grade || 0, orderNumber])

    // Create a default first category for this new course
    const catId = `cat_${Date.now()}`
    await pool.query(`
      INSERT INTO course_categories (id, course_id, name, order_num)
      VALUES (?, ?, '第一单元 / 核心表达', 1);
    `, [catId, id])

    res.json({ success: true, id })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.put('/api/courses/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { title, instructorName, instructorAvatar, cover, category, schoolLevel, grade, orderNum } = req.body

    const updates: string[] = []
    const values: any[] = []

    if (title !== undefined) {
      updates.push('title = ?')
      values.push(title)
    }
    if (instructorName !== undefined) {
      updates.push('instructor_name = ?')
      values.push(instructorName)
      if (!instructorAvatar) {
        updates.push('instructor_avatar = ?')
        values.push('https://api.dicebear.com/7.x/avataaars/svg?seed=' + instructorName)
      }
    }
    if (instructorAvatar !== undefined) {
      updates.push('instructor_avatar = ?')
      values.push(instructorAvatar)
    }
    if (cover !== undefined) {
      updates.push('cover = ?')
      values.push(cover)
    }
    if (category !== undefined) {
      updates.push('category = ?')
      values.push(category)
    }
    if (schoolLevel !== undefined) {
      updates.push('school_level = ?')
      values.push(schoolLevel)
    }
    if (grade !== undefined) {
      updates.push('grade = ?')
      values.push(Number(grade))
    }
    if (orderNum !== undefined) {
      updates.push('order_num = ?')
      values.push(Number(orderNum))
    }

    if (updates.length > 0) {
      values.push(id)
      await pool.query(`UPDATE courses SET ${updates.join(', ')} WHERE id = ?;`, values)
    }

    res.json({ success: true })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.delete('/api/courses/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params
    await pool.query('DELETE FROM courses WHERE id = ?;', [id])
    await pool.query('DELETE FROM course_categories WHERE course_id = ?;', [id])
    await pool.query('DELETE FROM lessons WHERE course_id = ?;', [id])
    res.json({ success: true })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.put('/api/courses/:id/favorite', requireUser, async (req, res) => {
  try {
    const { id } = req.params
    const userId = (req as any).userId as string

    // Check if favorited by this user
    const [existing] = await pool.query<any[]>(
      'SELECT id FROM user_favorites WHERE user_id = ? AND course_id = ?;',
      [userId, id]
    )

    let isFavorite = false
    if (existing.length > 0) {
      await pool.query('DELETE FROM user_favorites WHERE user_id = ? AND course_id = ?;', [userId, id])
      isFavorite = false
    } else {
      const favId = `fav_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      await pool.query(
        'INSERT INTO user_favorites (id, user_id, course_id) VALUES (?, ?, ?);',
        [favId, userId, id]
      )
      isFavorite = true
    }

    res.json({ success: true, isFavorite })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.get('/api/favorites', requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string
    const [rows] = await pool.query<any[]>(`
      SELECT c.*,
        (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id) AS real_lesson_count,
        TRUE AS user_is_favorite
      FROM courses c
      INNER JOIN user_favorites uf ON uf.course_id = c.id AND uf.user_id = ?
      ORDER BY uf.created_at DESC;
    `, [userId])

    res.json(rows.map(r => ({
      id: r.id,
      type: r.type,
      title: r.title,
      instructor: {
        name: r.instructor_name,
        avatar: r.instructor_avatar || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + r.instructor_name,
      },
      lessonCount: Number(r.real_lesson_count || 0),
      completedLessons: r.completed_lessons,
      cover: r.cover,
      category: r.category,
      schoolLevel: r.school_level,
      grade: r.grade,
      orderNum: r.order_num != null ? Number(r.order_num) : 99,
      isFavorite: true,
    })))
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.get('/api/courses/:id', async (req, res) => {
  try {
    const { id } = req.params
    const currentUserId = getAuthenticatedUserId(req) || ''
    const [cRows] = await pool.query<any[]>(`
      SELECT c.*,
        (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id) AS real_lesson_count,
        EXISTS(SELECT 1 FROM user_favorites uf WHERE uf.course_id = c.id AND uf.user_id = ?) AS user_is_favorite
      FROM courses c WHERE c.id = ?;
    `, [currentUserId, id])
    if (cRows.length === 0) return res.status(404).json({ message: 'Course not found' })

    const [catRows] = await pool.query<any[]>('SELECT * FROM course_categories WHERE course_id = ? ORDER BY order_num ASC;', [id])
    const [lessonRows] = await pool.query<any[]>(`
      SELECT l.*, 
        (SELECT COUNT(*) FROM sentences s WHERE s.lesson_id = l.id) as sentence_count
      FROM lessons l 
      WHERE l.course_id = ? 
      ORDER BY l.lesson_number ASC;
    `, [id])

    const r = cRows[0]
    res.json({
      course: {
        id: r.id,
        type: r.type,
        title: r.title,
        instructor: { name: r.instructor_name, avatar: r.instructor_avatar },
        lessonCount: Number(r.real_lesson_count || 0),
        cover: r.cover,
        category: r.category,
        schoolLevel: r.school_level,
        grade: r.grade,
        orderNum: r.order_num != null ? Number(r.order_num) : 99,
        isFavorite: Boolean(r.user_is_favorite),
      },
      categories: catRows.map(c => ({ id: c.id, courseId: c.course_id, name: c.name, orderNum: c.order_num })),
      lessons: lessonRows.map(l => ({
        id: l.id,
        courseId: l.course_id,
        categoryId: l.category_id,
        lessonNumber: l.lesson_number,
        titleEn: l.title_en,
        titleCn: l.title_cn,
        practiceTimeSeconds: l.practice_time_seconds,
        completedCount: l.completed_count,
        sentenceCount: l.sentence_count,
        isRecent: Boolean(l.is_recent),
      })),
    })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ==================== Course Categories & Hierarchical Import ====================
app.get('/api/courses/:id/categories', async (req, res) => {
  try {
    const { id } = req.params
    const [rows] = await pool.query<any[]>('SELECT * FROM course_categories WHERE course_id = ? ORDER BY order_num ASC;', [id])
    res.json(rows.map(r => ({
      id: r.id,
      courseId: r.course_id,
      name: r.name,
      orderNum: r.order_num,
    })))
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.post('/api/courses/:id/categories', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { name } = req.body
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Category name is required' })
    }
    const catId = `cat_${Date.now()}`
    const [countRows] = await pool.query<any[]>('SELECT COUNT(*) as cnt FROM course_categories WHERE course_id = ?;', [id])
    const orderNum = (countRows[0]?.cnt || 0) + 1

    await pool.query(`
      INSERT INTO course_categories (id, course_id, name, order_num)
      VALUES (?, ?, ?, ?);
    `, [catId, id, name.trim(), orderNum])

    res.json({ success: true, id: catId, name: name.trim() })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.delete('/api/categories/:categoryId', requireAdmin, async (req, res) => {
  try {
    const { categoryId } = req.params
    await pool.query('DELETE FROM course_categories WHERE id = ?;', [categoryId])
    await pool.query('DELETE FROM lessons WHERE category_id = ?;', [categoryId])
    res.json({ success: true })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ==================== Course Sections & Lesson-Level Import ====================
/**
 * Get all sections/lessons belonging directly to a course or teaching material
 */
app.get('/api/courses/:id/lessons', async (req, res) => {
  try {
    const { id } = req.params
    const [rows] = await pool.query<any[]>(`
      SELECT l.*, 
        (SELECT COUNT(*) FROM sentences s WHERE s.lesson_id = l.id) as sentence_count
      FROM lessons l 
      WHERE l.course_id = ? 
      ORDER BY l.lesson_number ASC;
    `, [id])
    res.json(rows.map(l => ({
      id: l.id,
      courseId: l.course_id,
      categoryId: l.category_id,
      lessonNumber: l.lesson_number,
      titleEn: l.title_en,
      titleCn: l.title_cn,
      practiceTimeSeconds: l.practice_time_seconds,
      completedCount: l.completed_count,
      sentenceCount: l.sentence_count,
      isRecent: Boolean(l.is_recent),
    })))
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

/**
 * Create a new section/lesson directly under a course or teaching material
 */
app.post('/api/courses/:id/lessons', requireAdmin, async (req, res) => {
  const conn = await pool.getConnection()
  try {
    const { id: courseId } = req.params
    const { lessonNumber, titleEn, titleCn, practiceTimeSeconds, txtContent } = req.body

    const [maxRows] = await conn.query<any[]>('SELECT COALESCE(MAX(lesson_number), 0) as max_num FROM lessons WHERE course_id = ?;', [courseId])
    const nextNum = lessonNumber && Number(lessonNumber) > 0 ? Number(lessonNumber) : (maxRows[0]?.max_num || 0) + 1
    const lessonId = `lesson_${Date.now()}`
    const lTitleEn = titleEn?.trim() || `Lesson ${nextNum}: Practice Unit`
    const lTitleCn = titleCn?.trim() || `第 ${nextNum} 节：核心表达与专项训练`

    let parsedSentences = null
    if (txtContent && txtContent.trim()) {
      const pRes = importerService.parseTxtContent(txtContent)
      if (!pRes.success || !pRes.sentences) {
        return res.status(400).json(pRes)
      }
      parsedSentences = pRes.sentences
    }

    const duration = practiceTimeSeconds && Number(practiceTimeSeconds) > 0
      ? Number(practiceTimeSeconds)
      : (parsedSentences ? Math.max(30, parsedSentences.length * 15) : 120)

    await conn.beginTransaction()

    await conn.query(`
      INSERT INTO lessons (id, course_id, category_id, lesson_number, title_en, title_cn, practice_time_seconds, completed_count, is_recent)
      VALUES (?, ?, NULL, ?, ?, ?, ?, 0, 0);
    `, [lessonId, courseId, nextNum, lTitleEn, lTitleCn, duration])

    if (parsedSentences) {
      for (const s of parsedSentences) {
        const sentenceId = `s_${Date.now()}_${s.index}`
        await conn.query(`
          INSERT INTO sentences (id, lesson_id, sentence_index, sentence_en, sentence_cn, image_url)
          VALUES (?, ?, ?, ?, ?, ?);
        `, [sentenceId, lessonId, s.index, s.sentenceEn, s.sentenceCn, s.imageUrl || null])

        for (const w of s.words) {
          const wordId = `w_${Date.now()}_${s.index}_${w.index}`
          await conn.query(`
            INSERT INTO words (id, sentence_id, word_index, word, meaning, phonetic, pos_tag)
            VALUES (?, ?, ?, ?, ?, ?, ?);
          `, [wordId, sentenceId, w.index, w.word, w.meaning, w.phonetic, w.posTag || null])
        }
      }
    }

    await conn.query(`
      UPDATE courses 
      SET lesson_count = (SELECT COUNT(*) FROM lessons WHERE course_id = ?)
      WHERE id = ?;
    `, [courseId, courseId])

    await conn.commit()
    res.json({
      success: true,
      lessonId,
      lessonNumber: nextNum,
      importedSentencesCount: parsedSentences ? parsedSentences.length : 0,
      practiceTimeSeconds: duration,
    })
  } catch (err: unknown) {
    await conn.rollback()
    res.status(500).json({ success: false, errorMessage: (err as Error).message })
  } finally {
    conn.release()
  }
})

/**
 * Update section/lesson information (titles, order, duration)
 */
app.put('/api/lessons/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { lessonNumber, titleEn, titleCn, practiceTimeSeconds } = req.body
    const updates: string[] = []
    const params: any[] = []

    if (lessonNumber !== undefined) {
      updates.push('lesson_number = ?')
      params.push(lessonNumber)
    }
    if (titleEn !== undefined) {
      updates.push('title_en = ?')
      params.push(titleEn.trim())
    }
    if (titleCn !== undefined) {
      updates.push('title_cn = ?')
      params.push(titleCn.trim())
    }
    if (practiceTimeSeconds !== undefined) {
      updates.push('practice_time_seconds = ?')
      params.push(Number(practiceTimeSeconds))
    }

    if (updates.length > 0) {
      params.push(id)
      await pool.query(`UPDATE lessons SET ${updates.join(', ')} WHERE id = ?;`, params)
    }
    res.json({ success: true })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

/**
 * Direct Import / Overwrite TXT Sentences into a specific Section/Lesson
 */
app.post('/api/lessons/:id/import', requireAdmin, async (req, res) => {
  const conn = await pool.getConnection()
  try {
    const { id: lessonId } = req.params
    const { txtContent, practiceTimeSeconds, titleEn, titleCn } = req.body

    if (!txtContent || !txtContent.trim()) {
      return res.status(400).json({ success: false, errorMessage: '缺少 TXT 文件内容' })
    }

    const [lRows] = await conn.query<any[]>('SELECT * FROM lessons WHERE id = ?;', [lessonId])
    if (lRows.length === 0) {
      return res.status(404).json({ success: false, errorMessage: '未找到指定小节' })
    }
    const currentLesson = lRows[0]
    const courseId = currentLesson.course_id

    // Strict parsing with ImporterService
    const parseResult = importerService.parseTxtContent(txtContent)
    if (!parseResult.success || !parseResult.sentences) {
      return res.status(400).json(parseResult)
    }

    await conn.beginTransaction()

    // 1. Delete existing sentences and words for this lesson
    const [oldSentences] = await conn.query<any[]>('SELECT id FROM sentences WHERE lesson_id = ?;', [lessonId])
    const oldSentenceIds = oldSentences.map(s => s.id)
    if (oldSentenceIds.length > 0) {
      await conn.query('DELETE FROM words WHERE sentence_id IN (?);', [oldSentenceIds])
    }
    await conn.query('DELETE FROM sentences WHERE lesson_id = ?;', [lessonId])

    // 2. Insert new sentences and words
    for (const s of parseResult.sentences) {
      const sentenceId = `s_${Date.now()}_${s.index}`
      await conn.query(`
        INSERT INTO sentences (id, lesson_id, sentence_index, sentence_en, sentence_cn, image_url)
        VALUES (?, ?, ?, ?, ?, ?);
      `, [sentenceId, lessonId, s.index, s.sentenceEn, s.sentenceCn, s.imageUrl || null])

      for (const w of s.words) {
        const wordId = `w_${Date.now()}_${s.index}_${w.index}`
        await conn.query(`
          INSERT INTO words (id, sentence_id, word_index, word, meaning, phonetic, pos_tag)
          VALUES (?, ?, ?, ?, ?, ?, ?);
        `, [wordId, sentenceId, w.index, w.word, w.meaning, w.phonetic, w.posTag || null])
      }
    }

    // 3. Duration seconds
    const durationSeconds = practiceTimeSeconds && Number(practiceTimeSeconds) > 0
      ? Number(practiceTimeSeconds)
      : Math.max(30, parseResult.sentences.length * 15)

    // 4. Update lesson info
    const lUpdates: string[] = ['practice_time_seconds = ?']
    const lParams: any[] = [durationSeconds]
    if (titleEn && titleEn.trim()) {
      lUpdates.push('title_en = ?')
      lParams.push(titleEn.trim())
    }
    if (titleCn && titleCn.trim()) {
      lUpdates.push('title_cn = ?')
      lParams.push(titleCn.trim())
    }
    lParams.push(lessonId)
    await conn.query(`UPDATE lessons SET ${lUpdates.join(', ')} WHERE id = ?;`, lParams)

    // 5. Update course lesson_count without shrinking planned count
    await conn.query(`
      UPDATE courses 
      SET lesson_count = GREATEST(lesson_count, (SELECT COUNT(*) FROM lessons WHERE course_id = ?))
      WHERE id = ?;
    `, [courseId, courseId])

    await conn.commit()

    res.json({
      success: true,
      lessonId,
      importedSentencesCount: parseResult.sentences.length,
      durationSeconds,
      message: `导入成功！已更新入库 ${parseResult.sentences.length} 道题目至该小节（练习时长 ${Math.floor(durationSeconds / 60)} 分 ${durationSeconds % 60} 秒）。`,
    })
  } catch (err: unknown) {
    await conn.rollback()
    res.status(500).json({ success: false, errorMessage: (err as Error).message })
  } finally {
    conn.release()
  }
})

/**
 * Delete a specific lesson and its sentences/words
 */
app.delete('/api/lessons/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const [lRows] = await pool.query<any[]>('SELECT course_id FROM lessons WHERE id = ?;', [id])
    const courseId = lRows[0]?.course_id

    const [sRows] = await pool.query<any[]>('SELECT id FROM sentences WHERE lesson_id = ?;', [id])
    const sentenceIds = sRows.map(s => s.id)
    if (sentenceIds.length > 0) {
      await pool.query('DELETE FROM words WHERE sentence_id IN (?);', [sentenceIds])
    }
    await pool.query('DELETE FROM sentences WHERE lesson_id = ?;', [id])
    await pool.query('DELETE FROM lessons WHERE id = ?;', [id])

    if (courseId) {
      await pool.query(`
        UPDATE courses 
        SET lesson_count = (SELECT COUNT(*) FROM lessons WHERE course_id = ?)
        WHERE id = ?;
      `, [courseId, courseId])
    }

    res.json({ success: true })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ==================== Lesson & Practice Details ====================
app.get('/api/lessons/:id', async (req, res) => {
  try {
    const { id } = req.params
    const [lRows] = await pool.query<any[]>('SELECT * FROM lessons WHERE id = ?;', [id])
    if (lRows.length === 0) return res.status(404).json({ message: 'Lesson not found' })

    const [sRows] = await pool.query<any[]>('SELECT * FROM sentences WHERE lesson_id = ? ORDER BY sentence_index ASC;', [id])
    const sentenceIds = sRows.map(s => s.id)

    let wordsMap: Record<string, any[]> = {}
    if (sentenceIds.length > 0) {
      const [wRows] = await pool.query<any[]>(
        `SELECT * FROM words WHERE sentence_id IN (?) ORDER BY word_index ASC;`,
        [sentenceIds]
      )
      wRows.forEach(w => {
        if (!wordsMap[w.sentence_id]) wordsMap[w.sentence_id] = []
        wordsMap[w.sentence_id].push({
          index: w.word_index,
          word: w.word,
          meaning: w.meaning,
          phonetic: w.phonetic,
          posTag: w.pos_tag,
        })
      })
    }

    const lesson = lRows[0]
    res.json({
      id: lesson.id,
      courseId: lesson.course_id,
      categoryId: lesson.category_id,
      lessonNumber: lesson.lesson_number,
      titleEn: lesson.title_en,
      titleCn: lesson.title_cn,
      practiceTimeSeconds: lesson.practice_time_seconds,
      completedCount: lesson.completed_count,
      isRecent: Boolean(lesson.is_recent),
      sentences: sRows.map(s => ({
        index: s.sentence_index,
        sentenceEn: s.sentence_en,
        sentenceCn: s.sentence_cn,
        imageUrl: s.image_url,
        words: wordsMap[s.id] || [],
      })),
    })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.post('/api/lessons/:id/complete', requireUser, async (req, res) => {
  try {
    const { id } = req.params
    const { durationSeconds } = req.body
    const secs = Number(durationSeconds) || 60

    // 1. Get lesson courseId
    const [lRows] = await pool.query<any[]>('SELECT course_id FROM lessons WHERE id = ?;', [id])
    if (lRows.length === 0) return res.status(404).json({ error: 'Lesson not found' })
    const courseId = lRows[0].course_id

    // 2. Set this lesson as completed and recent, and other lessons in course as not recent
    await pool.query('UPDATE lessons SET is_recent = FALSE WHERE course_id = ?;', [courseId])
    await pool.query(`
      UPDATE lessons 
      SET completed_count = completed_count + 1,
          practice_time_seconds = practice_time_seconds + ?,
          is_recent = TRUE
      WHERE id = ?;
    `, [secs, id])

    // 3. Update course completed_lessons count
    await pool.query(`
      UPDATE courses
      SET completed_lessons = (SELECT COUNT(*) FROM lessons WHERE course_id = ? AND completed_count > 0)
      WHERE id = ?;
    `, [courseId, courseId])

    // 4. Award lesson completion EXP (+20 base, x1.25 for VIP, capped by DAILY_EXP_CAP)
    let expGained = 0
    const userId = (req as any).userId as string
    const [uRows] = await pool.query<any[]>('SELECT * FROM user_profile WHERE id = ? LIMIT 1;', [userId])
    if (uRows.length > 0) {
      const synced = await syncAndFormatUserProfile(uRows[0])
      const rawGain = synced.isVipActive ? Math.round(20 * VIP_EXP_MULTIPLIER) : 20
      const remainingCap = Math.max(0, DAILY_EXP_CAP - (synced.todayExp || 0))
      expGained = Math.min(rawGain, remainingCap)
      if (expGained > 0) {
        const nextExp = synced.exp + expGained
        const nextLvl = getLevelInfo(nextExp).level
        await pool.query('UPDATE user_profile SET exp = exp + ?, today_exp = today_exp + ?, level = ? WHERE id = ?;', [
          expGained,
          expGained,
          nextLvl,
          userId,
        ])
      }
    }

    res.json({ success: true, expGained })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ==================== Reviews ====================
app.get('/api/reviews', requireUser, async (req, res) => {
  try {
    const { source } = req.query
    const currentUserId = (req as any).userId as string
    let sql = 'SELECT * FROM reviews WHERE user_id = ?'
    const params: any[] = [currentUserId]
    if (source) {
      sql += ' AND source = ?'
      params.push(source)
    }
    sql += ' ORDER BY created_at DESC;'
    const [rows] = await pool.query<any[]>(sql, params)

    res.json(rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      sentenceEn: r.sentence_en,
      sentenceCn: r.sentence_cn,
      phonetic: r.phonetic,
      words: typeof r.words_json === 'string' ? JSON.parse(r.words_json) : r.words_json || [],
      courseTitle: r.course_title,
      source: r.source,
      errorCount: r.error_count,
      isLearned: Boolean(r.is_learned),
      createdAt: r.created_at,
    })))
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.post('/api/reviews', requireUser, async (req, res) => {
  try {
    const { sentenceEn, sentenceCn, phonetic, words, courseTitle, source } = req.body
    const targetSource = source || 'error'
    const currentUserId = (req as any).userId as string

    // Check if record with same sentence and source exists for this user
    const [existing] = await pool.query<any[]>(
      'SELECT id, error_count FROM reviews WHERE user_id = ? AND sentence_en = ? AND source = ? LIMIT 1;',
      [currentUserId, sentenceEn, targetSource]
    )

    if (existing.length > 0) {
      const existingId = existing[0].id
      await pool.query(
        'UPDATE reviews SET error_count = error_count + 1 WHERE id = ?;',
        [existingId]
      )
      return res.json({ success: true, id: existingId, errorCount: existing[0].error_count + 1 })
    }

    const id = `rev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const createdAt = new Date().toISOString().replace('T', ' ').slice(0, 19)

    await pool.query(`
      INSERT INTO reviews (id, user_id, sentence_en, sentence_cn, phonetic, words_json, course_title, source, error_count, is_learned, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, FALSE, ?);
    `, [id, currentUserId, sentenceEn, sentenceCn, phonetic || '', JSON.stringify(words || []), courseTitle || '研习岛课程', targetSource, createdAt])

    res.json({ success: true, id })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.put('/api/reviews/:id/learned', requireUser, async (req, res) => {
  try {
    const { id } = req.params
    const { isLearned } = req.body
    const userId = (req as any).userId as string
    const targetVal = isLearned !== undefined ? Boolean(isLearned) : true
    await pool.query('UPDATE reviews SET is_learned = ? WHERE id = ? AND user_id = ?;', [targetVal, id, userId])
    res.json({ success: true })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.delete('/api/reviews/:id', requireUser, async (req, res) => {
  try {
    const { id } = req.params
    const userId = (req as any).userId as string
    await pool.query('DELETE FROM reviews WHERE id = ? AND user_id = ?;', [id, userId])
    res.json({ success: true })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.delete('/api/reviews', requireUser, async (req, res) => {
  try {
    const { ids } = req.body
    const userId = (req as any).userId as string
    if (Array.isArray(ids) && ids.length > 0) {
      await pool.query('DELETE FROM reviews WHERE id IN (?) AND user_id = ?;', [ids, userId])
    }
    res.json({ success: true })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ==================== Favorite Sentences ====================
app.get('/api/favorites/sentences', requireUser, async (req, res) => {
  try {
    const userId = (req as any).userId as string
    const [rows] = await pool.query<any[]>(
      'SELECT * FROM user_favorite_sentences WHERE user_id = ? ORDER BY created_at DESC;',
      [userId]
    )
    res.json(rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      sentenceId: r.sentence_id,
      sentenceEn: r.sentence_en,
      sentenceCn: r.sentence_cn,
      phonetic: r.phonetic,
      courseTitle: r.course_title,
      createdAt: r.created_at,
    })))
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.post('/api/favorites/sentences', requireUser, async (req, res) => {
  try {
    const { sentenceEn, sentenceCn, phonetic, courseTitle, sentenceId } = req.body
    if (!sentenceEn) return res.status(400).json({ error: 'sentenceEn is required' })
    const currentUserId = (req as any).userId as string
    const id = `fav_s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

    await pool.query(`
      INSERT INTO user_favorite_sentences (id, user_id, sentence_id, sentence_en, sentence_cn, phonetic, course_title)
      VALUES (?, ?, ?, ?, ?, ?, ?);
    `, [id, currentUserId, sentenceId || null, sentenceEn, sentenceCn || '', phonetic || '', courseTitle || ''])

    res.json({ success: true, id })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.post('/api/favorites/sentences/toggle', requireUser, async (req, res) => {
  try {
    const { sentenceEn, sentenceCn, phonetic, courseTitle, sentenceId } = req.body
    if (!sentenceEn) return res.status(400).json({ error: 'sentenceEn is required' })
    const currentUserId = (req as any).userId as string

    const [existing] = await pool.query<any[]>(
      'SELECT id FROM user_favorite_sentences WHERE user_id = ? AND sentence_en = ?;',
      [currentUserId, sentenceEn]
    )

    if (existing.length > 0) {
      await pool.query('DELETE FROM user_favorite_sentences WHERE id = ?;', [existing[0].id])
      res.json({ success: true, isFavorite: false, id: existing[0].id })
    } else {
      const id = `fav_s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      await pool.query(
        'INSERT INTO user_favorite_sentences (id, user_id, sentence_id, sentence_en, sentence_cn, phonetic, course_title) VALUES (?, ?, ?, ?, ?, ?, ?);',
        [id, currentUserId, sentenceId || null, sentenceEn, sentenceCn || '', phonetic || '', courseTitle || '']
      )
      res.json({ success: true, isFavorite: true, id })
    }
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.delete('/api/favorites/sentences/:id', requireUser, async (req, res) => {
  try {
    const { id } = req.params
    const userId = (req as any).userId as string
    await pool.query('DELETE FROM user_favorite_sentences WHERE id = ? AND user_id = ?;', [id, userId])
    res.json({ success: true })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ==================== Feedback Reports ====================
app.post('/api/reports', async (req, res) => {
  try {
    const { reportType, description, sentenceEn, courseTitle, userId } = req.body
    const currentUserId = userId || '8723192'
    const id = `rep_${Date.now()}`

    await pool.query(`
      INSERT INTO feedback_reports (id, user_id, report_type, description, sentence_en, course_title)
      VALUES (?, ?, ?, ?, ?, ?);
    `, [id, currentUserId, reportType || 'general', description || '', sentenceEn || '', courseTitle || ''])

    res.json({ success: true, id })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ==================== Microsoft Edge Neural TTS & Audio Cache ====================
const TTS_CACHE_DIR = path.join(PROJECT_ROOT, 'data', 'tts-cache')
if (!fs.existsSync(TTS_CACHE_DIR)) {
  fs.mkdirSync(TTS_CACHE_DIR, { recursive: true })
}

let activeTTSInstance: MsEdgeTTS | null = null

async function getOrInitTTS(voice: string): Promise<MsEdgeTTS> {
  if (!activeTTSInstance) {
    activeTTSInstance = new MsEdgeTTS()
    await activeTTSInstance.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
  } else {
    try {
      await activeTTSInstance.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
    } catch {
      try { activeTTSInstance.close() } catch {}
      activeTTSInstance = new MsEdgeTTS()
      await activeTTSInstance.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
    }
  }
  return activeTTSInstance
}

async function synthesizeEdgeAudio(text: string, voice = 'en-US-AvaNeural', speed = 1.0): Promise<Buffer> {
  const cleanText = text.trim()
  if (!cleanText) return Buffer.alloc(0)

  const rateNum = Math.round((Math.max(0.5, Math.min(2.0, speed)) - 1.0) * 100)
  const rateStr = rateNum >= 0 ? `+${rateNum}%` : `${rateNum}%`

  const hash = crypto.createHash('md5').update(`${cleanText}__${voice}__${rateStr}`).digest('hex')
  const cacheFile = path.join(TTS_CACHE_DIR, `${hash}.mp3`)

  if (fs.existsSync(cacheFile)) {
    return fs.readFileSync(cacheFile)
  }

  try {
    const tts = await getOrInitTTS(voice)
    const { audioStream } = tts.toStream(cleanText, { rate: rateStr })
    const chunks: Buffer[] = []
    const buf = await new Promise<Buffer>((resolve, reject) => {
      audioStream.on('data', chunk => chunks.push(chunk))
      audioStream.on('end', () => resolve(Buffer.concat(chunks)))
      audioStream.on('error', reject)
    })

    if (buf.length > 0) {
      fs.writeFileSync(cacheFile, buf)
    }
    return buf
  } catch (err) {
    console.warn('[TTS] Shared instance synthesis failed, retrying with fresh instance...', (err as Error).message)
    try { activeTTSInstance?.close() } catch {}
    activeTTSInstance = null

    const freshTTS = new MsEdgeTTS()
    await freshTTS.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
    const { audioStream } = freshTTS.toStream(cleanText, { rate: rateStr })
    const chunks: Buffer[] = []
    const buf = await new Promise<Buffer>((resolve, reject) => {
      audioStream.on('data', chunk => chunks.push(chunk))
      audioStream.on('end', () => {
        freshTTS.close()
        resolve(Buffer.concat(chunks))
      })
      audioStream.on('error', e => {
        freshTTS.close()
        reject(e)
      })
    })

    if (buf.length > 0) {
      fs.writeFileSync(cacheFile, buf)
    }
    return buf
  }
}

app.get('/api/tts', async (req, res) => {
  try {
    const text = (req.query.text as string || '').trim()
    if (!text) {
      return res.status(400).json({ error: 'Text query parameter is required' })
    }
    const voice = (req.query.voice as string || 'en-US-AvaNeural').trim()
    const speed = parseFloat(req.query.speed as string) || 1.0

    const audioBuf = await synthesizeEdgeAudio(text, voice, speed)
    res.setHeader('Content-Type', 'audio/mpeg')
    res.setHeader('Content-Length', audioBuf.length)
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    res.send(audioBuf)
  } catch (err: unknown) {
    console.error('[TTS API Error]', err)
    res.status(500).json({ error: (err as Error).message })
  }
})

// ==================== TTS Dictionary ====================
app.get('/api/tts/dictionary', async (_, res) => {
  try {
    const [rows] = await pool.query<any[]>('SELECT * FROM tts_dictionary ORDER BY created_at DESC;')
    res.json(rows.map(r => ({
      id: r.id,
      word: r.word,
      spokenAlias: r.spoken_alias,
      ipa: r.ipa,
    })))
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.post('/api/tts/dictionary', requireAdmin, async (req, res) => {
  try {
    const { word, spokenAlias, ipa } = req.body
    if (!word || !word.trim()) return res.status(400).json({ error: 'Word is required' })
    const id = `dict_${Date.now()}`

    await pool.query(`
      INSERT INTO tts_dictionary (id, word, spoken_alias, ipa)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE spoken_alias=VALUES(spoken_alias), ipa=VALUES(ipa);
    `, [id, word.trim(), spokenAlias?.trim() || '', ipa?.trim() || ''])

    res.json({ success: true, id })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.delete('/api/tts/dictionary/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params
    await pool.query('DELETE FROM tts_dictionary WHERE id = ?;', [id])
    res.json({ success: true })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ==================== Category Management (Courses & Teaching) ====================
// Course Categories
app.get('/api/categories/courses', async (_, res) => {
  try {
    const [rows] = await pool.query<any[]>(`
      SELECT c.*,
        (SELECT COUNT(*) FROM courses WHERE courses.type = 'course' AND courses.category = c.cat_key) as course_count
      FROM category_courses c
      ORDER BY c.order_num ASC, c.created_at ASC;
    `)
    res.json(rows.map(r => ({
      id: r.id,
      catKey: r.cat_key,
      name: r.name,
      orderNum: r.order_num,
      isEnabled: Boolean(r.is_enabled),
      courseCount: Number(r.course_count || 0)
    })))
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.post('/api/categories/courses', requireAdmin, async (req, res) => {
  try {
    const { name, catKey, orderNum, isEnabled } = req.body
    if (!name || !name.trim() || !catKey || !catKey.trim()) {
      return res.status(400).json({ error: '分类名称与编码Key必填' })
    }
    const id = `cat_${Date.now()}`
    await pool.query(`
      INSERT INTO category_courses (id, cat_key, name, order_num, is_enabled)
      VALUES (?, ?, ?, ?, ?);
    `, [id, catKey.trim().toLowerCase(), name.trim(), Number(orderNum) || 99, isEnabled !== false])
    res.json({ success: true, id })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.put('/api/categories/courses/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { name, catKey, orderNum, isEnabled } = req.body
    await pool.query(`
      UPDATE category_courses
      SET name = COALESCE(?, name),
          cat_key = COALESCE(?, cat_key),
          order_num = COALESCE(?, order_num),
          is_enabled = COALESCE(?, is_enabled)
      WHERE id = ?;
    `, [
      name ? name.trim() : null,
      catKey ? catKey.trim().toLowerCase() : null,
      orderNum !== undefined ? Number(orderNum) : null,
      isEnabled !== undefined ? (isEnabled ? 1 : 0) : null,
      id
    ])
    res.json({ success: true })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.delete('/api/categories/courses/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const [cRows] = await pool.query<any[]>('SELECT cat_key FROM category_courses WHERE id = ?;', [id])
    if (cRows.length > 0) {
      const catKey = cRows[0].cat_key
      const [used] = await pool.query<any[]>('SELECT COUNT(*) as cnt FROM courses WHERE type = "course" AND category = ?;', [catKey])
      if (used[0].cnt > 0) {
        return res.status(400).json({ error: `该分类下仍有关联的 ${used[0].cnt} 门课程，请先调整相关课程分类后再删除，或将其设为停用。` })
      }
    }
    await pool.query('DELETE FROM category_courses WHERE id = ?;', [id])
    res.json({ success: true })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// Teaching Material Categories (School Levels & Grades)
app.get('/api/categories/teaching', async (_, res) => {
  try {
    const [levelRows] = await pool.query<any[]>(`
      SELECT l.*,
        (SELECT COUNT(*) FROM courses WHERE courses.type = 'teaching' AND courses.school_level = l.level_key) as teaching_count
      FROM category_school_levels l
      ORDER BY l.order_num ASC, l.created_at ASC;
    `)
    const [gradeRows] = await pool.query<any[]>(`
      SELECT g.*,
        (SELECT COUNT(*) FROM courses WHERE courses.type = 'teaching' AND courses.school_level = g.level_key AND courses.grade = g.grade_value) as teaching_count
      FROM category_grades g
      ORDER BY g.order_num ASC, g.grade_value ASC;
    `)

    const levels = levelRows.map(l => ({
      id: l.id,
      levelKey: l.level_key,
      name: l.name,
      orderNum: l.order_num,
      isEnabled: Boolean(l.is_enabled),
      teachingCount: Number(l.teaching_count || 0),
      grades: gradeRows
        .filter(g => g.level_key === l.level_key)
        .map(g => ({
          id: g.id,
          levelKey: g.level_key,
          gradeValue: Number(g.grade_value),
          name: g.name,
          orderNum: g.order_num,
          isEnabled: Boolean(g.is_enabled),
          teachingCount: Number(g.teaching_count || 0)
        }))
    }))

    res.json(levels)
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.post('/api/categories/school-levels', requireAdmin, async (req, res) => {
  try {
    const { name, levelKey, orderNum, isEnabled } = req.body
    if (!name || !name.trim() || !levelKey || !levelKey.trim()) {
      return res.status(400).json({ error: '学段名称与编码Key必填' })
    }
    const id = `lvl_${Date.now()}`
    await pool.query(`
      INSERT INTO category_school_levels (id, level_key, name, order_num, is_enabled)
      VALUES (?, ?, ?, ?, ?);
    `, [id, levelKey.trim().toLowerCase(), name.trim(), Number(orderNum) || 99, isEnabled !== false])
    res.json({ success: true, id })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.put('/api/categories/school-levels/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { name, levelKey, orderNum, isEnabled } = req.body
    await pool.query(`
      UPDATE category_school_levels
      SET name = COALESCE(?, name),
          level_key = COALESCE(?, level_key),
          order_num = COALESCE(?, order_num),
          is_enabled = COALESCE(?, is_enabled)
      WHERE id = ?;
    `, [
      name ? name.trim() : null,
      levelKey ? levelKey.trim().toLowerCase() : null,
      orderNum !== undefined ? Number(orderNum) : null,
      isEnabled !== undefined ? (isEnabled ? 1 : 0) : null,
      id
    ])
    res.json({ success: true })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.delete('/api/categories/school-levels/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const [lRows] = await pool.query<any[]>('SELECT level_key FROM category_school_levels WHERE id = ?;', [id])
    if (lRows.length > 0) {
      const levelKey = lRows[0].level_key
      const [used] = await pool.query<any[]>('SELECT COUNT(*) as cnt FROM courses WHERE type = "teaching" AND school_level = ?;', [levelKey])
      if (used[0].cnt > 0) {
        return res.status(400).json({ error: `该学段下仍有关联的 ${used[0].cnt} 本教辅，请先调整相关教辅学段后再删除，或将其设为停用。` })
      }
    }
    await pool.query('DELETE FROM category_school_levels WHERE id = ?;', [id])
    res.json({ success: true })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.post('/api/categories/grades', requireAdmin, async (req, res) => {
  try {
    const { levelKey, gradeValue, name, orderNum, isEnabled } = req.body
    if (!name || !name.trim() || !levelKey || gradeValue === undefined) {
      return res.status(400).json({ error: '年级名称、所属学段与年级数值必填' })
    }
    const id = `grd_${Date.now()}`
    await pool.query(`
      INSERT INTO category_grades (id, level_key, grade_value, name, order_num, is_enabled)
      VALUES (?, ?, ?, ?, ?, ?);
    `, [id, levelKey.trim(), Number(gradeValue), name.trim(), Number(orderNum) || 99, isEnabled !== false])
    res.json({ success: true, id })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.put('/api/categories/grades/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const { levelKey, gradeValue, name, orderNum, isEnabled } = req.body
    await pool.query(`
      UPDATE category_grades
      SET name = COALESCE(?, name),
          level_key = COALESCE(?, level_key),
          grade_value = COALESCE(?, grade_value),
          order_num = COALESCE(?, order_num),
          is_enabled = COALESCE(?, is_enabled)
      WHERE id = ?;
    `, [
      name ? name.trim() : null,
      levelKey ? levelKey.trim() : null,
      gradeValue !== undefined ? Number(gradeValue) : null,
      orderNum !== undefined ? Number(orderNum) : null,
      isEnabled !== undefined ? (isEnabled ? 1 : 0) : null,
      id
    ])
    res.json({ success: true })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.delete('/api/categories/grades/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params
    const [gRows] = await pool.query<any[]>('SELECT level_key, grade_value FROM category_grades WHERE id = ?;', [id])
    if (gRows.length > 0) {
      const { level_key, grade_value } = gRows[0]
      const [used] = await pool.query<any[]>('SELECT COUNT(*) as cnt FROM courses WHERE type = "teaching" AND school_level = ? AND grade = ?;', [level_key, grade_value])
      if (used[0].cnt > 0) {
        return res.status(400).json({ error: `该年级下仍有关联的 ${used[0].cnt} 本教辅，请先调整教辅年级后再删除，或将其设为停用。` })
      }
    }
    await pool.query('DELETE FROM category_grades WHERE id = ?;', [id])
    res.json({ success: true })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ==================== Independent Admin Authentication ====================
app.post('/api/admin/login', adminAuthRateLimiter, async (req, res) => {
  try {
    const { username, password } = req.body
    const uname = String(username || '').trim()
    if (!uname || !password) {
      return res.status(400).json({ error: '请输入管理员账号和密码' })
    }
    const lockedSec = isAdminLoginLocked(uname)
    if (lockedSec > 0) {
      return res.status(429).json({ error: `管理员密码错误次数过多，账号已临时锁定，请 ${Math.ceil(lockedSec / 60)} 分钟后再试` })
    }
    const [rows] = await pool.query<any[]>('SELECT * FROM admin_users WHERE username = ? LIMIT 1;', [uname])
    if (rows.length === 0 || !verifyPassword(String(password), rows[0].password_hash)) {
      recordAdminLoginFailure(uname)
      return res.status(401).json({ error: '管理员账号或密码错误' })
    }
    clearAdminLoginFailures(uname)
    const admin = rows[0]
    const token = signAdminToken(admin.id, admin.username)
    await logAdminAudit(admin.username, 'ADMIN_LOGIN', '', '', '管理员登录独立后台')
    res.json({
      success: true,
      token,
      admin: {
        id: admin.id,
        username: admin.username,
        role: admin.role,
        isImmutable: Boolean(admin.is_immutable),
      },
    })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.get('/api/admin/me', async (req, res) => {
  try {
    const payload = (req as any).admin
    const [rows] = await pool.query<any[]>('SELECT id, username, role, is_immutable, created_at FROM admin_users WHERE id = ? LIMIT 1;', [payload.sub])
    if (rows.length === 0) return res.status(404).json({ error: '管理员不存在' })
    const a = rows[0]
    res.json({
      id: a.id,
      username: a.username,
      role: a.role,
      isImmutable: Boolean(a.is_immutable),
      createdAt: a.created_at,
    })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.post('/api/admin/change-password', async (req, res) => {
  try {
    const payload = (req as any).admin
    const { oldPassword, newPassword, newUsername } = req.body
    const [rows] = await pool.query<any[]>('SELECT * FROM admin_users WHERE id = ? LIMIT 1;', [payload.sub])
    if (rows.length === 0) return res.status(404).json({ error: '管理员不存在' })
    const admin = rows[0]

    if (newUsername !== undefined && newUsername !== admin.username && Boolean(admin.is_immutable)) {
      return res.status(403).json({ error: '默认超级管理员账号名称锁定，不可修改' })
    }
    if (!oldPassword || !verifyPassword(String(oldPassword), admin.password_hash)) {
      return res.status(400).json({ error: '原密码不正确' })
    }
    if (!newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ error: '新密码长度不能少于 6 位' })
    }

    await pool.query("UPDATE admin_users SET password_hash = ?, updated_at = datetime('now', 'localtime') WHERE id = ?;", [
      hashPassword(String(newPassword)),
      admin.id,
    ])
    await logAdminAudit(admin.username, 'ADMIN_CHANGE_PASSWORD', '', '', '修改管理员密码')
    res.json({ success: true, message: '管理员密码修改成功' })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ==================== Admin User Management Endpoints ====================
// 1. Get all users with filters and stats
app.get('/api/admin/users', async (req, res) => {
  try {
    const { keyword, role, status, vipFilter } = req.query
    let query = `
      SELECT 
        u.*,
        (SELECT COALESCE(SUM(study_seconds), 0) FROM user_course_progress WHERE user_id = u.id) as real_prog_seconds,
        (SELECT COUNT(*) FROM user_course_progress WHERE user_id = u.id) as progress_count,
        (SELECT COUNT(*) FROM user_favorites WHERE user_id = u.id) as fav_course_count,
        (SELECT COUNT(*) FROM user_favorite_sentences WHERE user_id = u.id) as fav_sentence_count,
        (SELECT COUNT(*) FROM reviews WHERE user_id = u.id) as review_count,
        (SELECT COUNT(*) FROM reviews WHERE user_id = u.id AND is_learned = 1) as learned_count
      FROM user_profile u
      WHERE 1=1
    `
    const params: any[] = []

    if (keyword && typeof keyword === 'string' && keyword.trim()) {
      const kw = `%${keyword.trim()}%`
      query += ` AND (u.id LIKE ? OR u.nickname LIKE ? OR u.phone LIKE ? OR u.email LIKE ?)`
      params.push(kw, kw, kw, kw)
    }

    if (role && typeof role === 'string' && role !== 'all') {
      query += ` AND u.role = ?`
      params.push(role)
    }

    if (status && typeof status === 'string' && status !== 'all') {
      query += ` AND u.status = ?`
      params.push(status)
    }

    query += ` ORDER BY u.updated_at DESC, u.created_at DESC;`

    const [rows] = await pool.query<any[]>(query, params)
    let users = await Promise.all(
      rows.map(async r => {
        const formatted = await syncAndFormatUserProfile(r)
        const progCount = Number(r.progress_count || 0)
        const realSeconds = Math.max(Number(r.real_prog_seconds || 0), Number(r.total_study_seconds || 0))
        return {
          ...formatted,
          totalStudySeconds: realSeconds,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          progressCount: progCount,
          favCourseCount: Number(r.fav_course_count || 0),
          favSentenceCount: Number(r.fav_sentence_count || 0),
          reviewCount: Number(r.review_count || 0),
          learnedCount: Number(r.learned_count || 0),
        }
      })
    )

    if (vipFilter && typeof vipFilter === 'string' && vipFilter !== 'all') {
      if (vipFilter === 'expired') {
        users = users.filter(u => !u.isVipActive && u.hasEverVip)
      } else if (vipFilter === 'expiring_soon') {
        users = users.filter(u => u.isVipActive && u.vipRemainingDays !== null && u.vipRemainingDays <= 3)
      } else {
        users = users.filter(u => u.vipType === vipFilter)
      }
    }

    res.json(users)
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// 2. Get single user detail & aggregated statistics
app.get('/api/admin/users/:id/detail', async (req, res) => {
  try {
    const { id } = req.params
    const [rows] = await pool.query<any[]>('SELECT * FROM user_profile WHERE id = ? LIMIT 1;', [id])
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' })
    }
    const r = rows[0]

    const [progStats] = await pool.query<any[]>(`
      SELECT 
        COUNT(*) as total_courses,
        COALESCE(SUM(study_seconds), 0) as total_prog_seconds,
        COALESCE(AVG(progress_percent), 0) as avg_progress
      FROM user_course_progress 
      WHERE user_id = ?;
    `, [id])

    const [favStats] = await pool.query<any[]>(`
      SELECT 
        (SELECT COUNT(*) FROM user_favorites WHERE user_id = ?) as fav_courses,
        (SELECT COUNT(*) FROM user_favorite_sentences WHERE user_id = ?) as fav_sentences;
    `, [id, id])

    const [revStats] = await pool.query<any[]>(`
      SELECT 
        COUNT(*) as total_reviews,
        COALESCE(SUM(CASE WHEN is_learned = 1 THEN 1 ELSE 0 END), 0) as learned_count,
        COALESCE(SUM(CASE WHEN source = 'error' THEN 1 ELSE 0 END), 0) as error_count,
        COALESCE(SUM(CASE WHEN source = 'unfamiliar' THEN 1 ELSE 0 END), 0) as unfamiliar_count
      FROM reviews 
      WHERE user_id = ?;
    `, [id])

    const todayStr = new Date().toLocaleDateString('en-CA')
    const totalCourses = Number(progStats[0]?.total_courses || 0)
    const realStudySecs = Math.max(Number(progStats[0]?.total_prog_seconds || 0), Number(r.total_study_seconds || 0))
    const realSentenceCount = Number(r.total_sentence_count || 0)

    res.json({
      user: {
        id: r.id,
        nickname: r.nickname,
        avatar: r.avatar,
        role: r.role || '普通用户',
        phone: r.phone || '',
        email: r.email || '',
        status: r.status || 'active',
        totalStudySeconds: realStudySecs,
        todayStudySeconds: r.today_study_seconds || 0,
        monthStudySeconds: r.month_study_seconds || 0,
        totalSentenceCount: realSentenceCount,
        todaySentenceCount: r.today_sentence_count || 0,
        continuousDays: r.continuous_days || 0,
        lastCheckinDate: r.last_checkin_date || null,
        hasCheckedInToday: r.last_checkin_date === todayStr,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      },
      stats: {
        totalCoursesPracticed: Number(progStats[0]?.total_courses || 0),
        avgProgress: Math.round(Number(progStats[0]?.avg_progress || 0)),
        favCourses: Number(favStats[0]?.fav_courses || 0),
        favSentences: Number(favStats[0]?.fav_sentences || 0),
        totalReviews: Number(revStats[0]?.total_reviews || 0),
        learnedReviews: Number(revStats[0]?.learned_count || 0),
        errorReviews: Number(revStats[0]?.error_count || 0),
        unfamiliarReviews: Number(revStats[0]?.unfamiliar_count || 0),
      }
    })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// 3. Get user learning progress
app.get('/api/admin/users/:id/progress', async (req, res) => {
  try {
    const { id } = req.params
    const [rows] = await pool.query<any[]>(`
      SELECT 
        p.*,
        c.cover as course_cover,
        c.type as course_type,
        c.category as course_category,
        c.school_level as course_school_level,
        c.grade as course_grade,
        c.lesson_count as course_total_lessons
      FROM user_course_progress p
      LEFT JOIN courses c ON p.course_id = c.id
      WHERE p.user_id = ?
      ORDER BY p.last_practiced_at DESC;
    `, [id])

    const progressList = rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      courseId: r.course_id,
      courseTitle: r.course_title || '未知课程',
      courseCover: r.course_cover || '',
      courseType: r.course_type || 'course',
      courseCategory: r.course_category,
      courseSchoolLevel: r.course_school_level,
      courseGrade: r.course_grade,
      lessonId: r.lesson_id,
      lessonTitle: r.lesson_title || '当前小节',
      lessonNumber: r.lesson_number || 1,
      totalCourseLessons: r.course_total_lessons || 0,
      sentenceIndex: r.sentence_index || 0,
      totalSentences: r.total_sentences || 0,
      progressPercent: r.progress_percent || 0,
      studySeconds: r.study_seconds || 0,
      lastPracticedAt: r.last_practiced_at,
    }))

    res.json(progressList)
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// 4. Get user favorites (Courses & Sentences)
app.get('/api/admin/users/:id/favorites', async (req, res) => {
  try {
    const { id } = req.params
    const [courseRows] = await pool.query<any[]>(`
      SELECT 
        f.id as fav_id,
        f.created_at as favorited_at,
        c.id as course_id,
        c.title,
        c.cover,
        c.type,
        c.instructor_name,
        c.lesson_count,
        c.category,
        c.school_level,
        c.grade
      FROM user_favorites f
      JOIN courses c ON f.course_id = c.id
      WHERE f.user_id = ?
      ORDER BY f.created_at DESC;
    `, [id])

    const [sentenceRows] = await pool.query<any[]>(`
      SELECT 
        id,
        sentence_id,
        sentence_en,
        sentence_cn,
        phonetic,
        course_title,
        created_at
      FROM user_favorite_sentences
      WHERE user_id = ?
      ORDER BY created_at DESC;
    `, [id])

    res.json({
      courses: courseRows.map(c => ({
        favId: c.fav_id,
        courseId: c.course_id,
        title: c.title,
        cover: c.cover,
        type: c.type,
        instructorName: c.instructor_name,
        lessonCount: c.lesson_count,
        category: c.category,
        schoolLevel: c.school_level,
        grade: c.grade,
        favoritedAt: c.favorited_at,
      })),
      sentences: sentenceRows.map(s => ({
        id: s.id,
        sentenceId: s.sentence_id,
        sentenceEn: s.sentence_en,
        sentenceCn: s.sentence_cn,
        phonetic: s.phonetic,
        courseTitle: s.course_title,
        createdAt: s.created_at,
      }))
    })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// 5. Get user reviews (Error notebook & Unfamiliar list)
app.get('/api/admin/users/:id/reviews', async (req, res) => {
  try {
    const { id } = req.params
    const [rows] = await pool.query<any[]>(`
      SELECT * FROM reviews 
      WHERE user_id = ?
      ORDER BY created_at DESC;
    `, [id])

    const reviews = rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      sentenceEn: r.sentence_en,
      sentenceCn: r.sentence_cn,
      phonetic: r.phonetic,
      words: typeof r.words_json === 'string' ? JSON.parse(r.words_json || '[]') : (r.words_json || []),
      courseTitle: r.course_title,
      source: r.source,
      errorCount: r.error_count || 1,
      isLearned: Boolean(r.is_learned),
      createdAt: r.created_at,
    }))

    res.json(reviews)
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// 6. Update user basic information & status
app.put('/api/admin/users/:id', async (req, res) => {
  try {
    const { id } = req.params
    const { nickname, avatar, role, status, phone, email } = req.body
    const adminUsername = (req as any).admin?.username || 'admin'

    const updates: string[] = []
    const values: any[] = []

    if (nickname !== undefined) {
      updates.push('nickname = ?')
      values.push(nickname.trim())
    }
    if (avatar !== undefined) {
      updates.push('avatar = ?')
      values.push(avatar)
    }
    if (role !== undefined) {
      updates.push('role = ?')
      values.push(role)
    }
    if (status !== undefined) {
      updates.push('status = ?')
      values.push(status)
    }
    if (phone !== undefined) {
      updates.push('phone = ?')
      values.push(phone.trim())
    }
    if (email !== undefined) {
      updates.push('email = ?')
      values.push(email.trim().toLowerCase())
    }

    if (updates.length > 0) {
      values.push(id)
      await pool.query(`UPDATE user_profile SET ${updates.join(', ')} WHERE id = ?;`, values)
      await logAdminAudit(adminUsername, 'UPDATE_USER', id, email || '', `修改用户信息: ${updates.join(', ')}`)
    }

    res.json({ success: true })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// 6.1 Toggle account active/disabled status
app.put('/api/admin/users/:id/status', async (req, res) => {
  try {
    const { id } = req.params
    const { status } = req.body
    if (!['active', 'disabled'].includes(status)) {
      return res.status(400).json({ error: '无效的状态值' })
    }
    const adminUsername = (req as any).admin?.username || 'admin'
    const [uRows] = await pool.query<any[]>('SELECT email FROM user_profile WHERE id = ? LIMIT 1;', [id])
    if (uRows.length === 0) return res.status(404).json({ error: '用户不存在' })

    await pool.query('UPDATE user_profile SET status = ? WHERE id = ?;', [status, id])
    await logAdminAudit(adminUsername, status === 'disabled' ? 'DISABLE_USER' : 'ENABLE_USER', id, uRows[0].email || '', status === 'disabled' ? '停用账号' : '启用账号')
    res.json({ success: true, status })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// 6.2 Update user VIP type and expiration date (with from_now / extend / custom override)
app.put('/api/admin/users/:id/vip', async (req, res) => {
  try {
    const { id } = req.params
    const { vipType, mode = 'from_now', customExpireAt } = req.body as {
      vipType: VipType
      mode?: 'from_now' | 'extend'
      customExpireAt?: string | null
    }
    const adminUsername = (req as any).admin?.username || 'admin'

    const [rows] = await pool.query<any[]>('SELECT * FROM user_profile WHERE id = ? LIMIT 1;', [id])
    if (rows.length === 0) return res.status(404).json({ error: '用户不存在' })
    const user = rows[0]

    if (!['free', 'vip_monthly', 'vip_half_year', 'vip_lifetime'].includes(vipType)) {
      return res.status(400).json({ error: '无效的用户类型' })
    }

    let nextExpireAt: string | null = null
    if (vipType === 'vip_monthly' || vipType === 'vip_half_year') {
      if (customExpireAt) {
        nextExpireAt = customExpireAt.length === 16 ? `${customExpireAt}:00` : customExpireAt
      } else if (mode === 'extend' && user.vip_expire_at && new Date(user.vip_expire_at).getTime() > Date.now()) {
        nextExpireAt = calculateVipExpiration(vipType, new Date(user.vip_expire_at))
      } else {
        nextExpireAt = calculateVipExpiration(vipType, new Date())
      }
    }

    const nextRole = VIP_TYPE_INFO[vipType]?.label || '普通用户'
    const isVip = vipType !== 'free'
    const hasEverVip = isVip ? 1 : Number(user.has_ever_vip || 0)
    const lastVipType = isVip ? vipType : user.last_vip_type

    await pool.query(
      'UPDATE user_profile SET vip_type = ?, vip_expire_at = ?, role = ?, has_ever_vip = ?, last_vip_type = ? WHERE id = ?;',
      [vipType, nextExpireAt, nextRole, hasEverVip, lastVipType, id]
    )

    await logAdminAudit(
      adminUsername,
      'UPDATE_VIP',
      id,
      user.email || '',
      `调整为 ${nextRole}，终止时间: ${nextExpireAt || (vipType === 'vip_lifetime' ? '永久有效' : '无')}`
    )

    const [updatedRows] = await pool.query<any[]>('SELECT * FROM user_profile WHERE id = ? LIMIT 1;', [id])
    const formatted = await syncAndFormatUserProfile(updatedRows[0])
    res.json({ success: true, user: formatted })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// 6.3 Adjust user EXP / Level manually
app.put('/api/admin/users/:id/level-exp', async (req, res) => {
  try {
    const { id } = req.params
    const { exp } = req.body
    const adminUsername = (req as any).admin?.username || 'admin'
    const safeExp = Math.max(0, Math.floor(Number(exp) || 0))
    const levelInfo = getLevelInfo(safeExp)

    const [rows] = await pool.query<any[]>('SELECT email FROM user_profile WHERE id = ? LIMIT 1;', [id])
    if (rows.length === 0) return res.status(404).json({ error: '用户不存在' })

    await pool.query('UPDATE user_profile SET exp = ?, level = ? WHERE id = ?;', [safeExp, levelInfo.level, id])
    await logAdminAudit(adminUsername, 'ADJUST_EXP', id, rows[0].email || '', `调整经验至 ${safeExp} (Lv.${levelInfo.level})`)
    res.json({ success: true, exp: safeExp, level: levelInfo.level })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// 6.4 Reset user password to random 8-char password & send email
app.post('/api/admin/users/:id/reset-password', async (req, res) => {
  try {
    const { id } = req.params
    const adminUsername = (req as any).admin?.username || 'admin'
    const [rows] = await pool.query<any[]>('SELECT * FROM user_profile WHERE id = ? LIMIT 1;', [id])
    if (rows.length === 0) return res.status(404).json({ error: '用户不存在' })
    const user = rows[0]
    if (!user.email) return res.status(400).json({ error: '该用户未绑定邮箱，请先编辑绑定邮箱后再重置密码' })

    const tempPassword = generateTempPassword8()
    const resetToken = generateResetToken()
    const expires = formatLocalDateTime(new Date(Date.now() + 24 * 60 * 60 * 1000))

    await pool.query(
      'UPDATE user_profile SET password_hash = ?, must_change_password = 1, reset_token = ?, reset_token_expires = ? WHERE id = ?;',
      [hashPassword(tempPassword), resetToken, expires, id]
    )

    const resetLink = `${getClientOrigin(req)}/change-password?token=${resetToken}`
    const emailRes = await sendAccountProvisionEmail({
      email: user.email,
      nickname: user.nickname,
      tempPassword,
      resetLink,
      vipType: user.vip_type || 'free',
      vipExpireAt: user.vip_expire_at,
      isReset: true,
    })

    await logAdminAudit(adminUsername, 'RESET_PASSWORD', id, user.email, `重置为随机8位密码并发送邮件 (${emailRes.status})`)
    res.json({
      success: true,
      tempPassword,
      resetLink,
      emailStatus: emailRes.status,
      errorMsg: emailRes.errorMsg,
    })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// 7. Create a new user by Email + VIP Type (generates 8-char temp pwd + sends email with reset link)
app.post('/api/admin/users', async (req, res) => {
  try {
    const { nickname, avatar, phone, email, status, vipType = 'free', customExpireAt } = req.body as {
      nickname?: string
      avatar?: string
      phone?: string
      email: string
      status?: string
      vipType?: VipType
      customExpireAt?: string | null
    }
    const adminUsername = (req as any).admin?.username || 'admin'

    if (!email || !email.trim() || !email.includes('@')) {
      return res.status(400).json({ error: '请输入有效的用户邮箱地址' })
    }
    const cleanEmail = email.trim().toLowerCase()

    const [dupRows] = await pool.query<any[]>('SELECT id FROM user_profile WHERE LOWER(email) = ? LIMIT 1;', [cleanEmail])
    if (dupRows.length > 0) {
      return res.status(400).json({ error: '该邮箱已被注册使用' })
    }

    const finalNickname = nickname && nickname.trim() ? nickname.trim() : cleanEmail.split('@')[0]
    const newId = String(Math.floor(1000000 + Math.random() * 9000000))
    const userAvatar = avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(finalNickname)}`

    const tempPassword = generateTempPassword8()
    const resetToken = generateResetToken()
    const resetExpires = formatLocalDateTime(new Date(Date.now() + 24 * 60 * 60 * 1000))

    let vipExpireAt: string | null = null
    if (vipType === 'vip_monthly' || vipType === 'vip_half_year') {
      vipExpireAt = customExpireAt
        ? (customExpireAt.length === 16 ? `${customExpireAt}:00` : customExpireAt)
        : calculateVipExpiration(vipType, new Date())
    }

    const roleLabel = VIP_TYPE_INFO[vipType]?.label || '普通用户'
    const isVip = vipType !== 'free'

    await pool.query(`
      INSERT INTO user_profile 
      (id, nickname, avatar, role, phone, email, password_hash, must_change_password, reset_token, reset_token_expires, status,
       exp, level, vip_type, vip_expire_at, has_ever_vip, last_vip_type,
       total_study_seconds, today_study_seconds, month_study_seconds, total_sentence_count, today_sentence_count, continuous_days)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 0, 1, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0);
    `, [
      newId,
      finalNickname,
      userAvatar,
      roleLabel,
      phone ? phone.trim() : null,
      cleanEmail,
      hashPassword(tempPassword),
      resetToken,
      resetExpires,
      status || 'active',
      vipType,
      vipExpireAt,
      isVip ? 1 : 0,
      isVip ? vipType : null,
    ])

    const resetLink = `${getClientOrigin(req)}/change-password?token=${resetToken}`
    const emailRes = await sendAccountProvisionEmail({
      email: cleanEmail,
      nickname: finalNickname,
      tempPassword,
      resetLink,
      vipType,
      vipExpireAt,
      isReset: false,
    })

    await logAdminAudit(
      adminUsername,
      'CREATE_USER',
      newId,
      cleanEmail,
      `创建用户 [${roleLabel}]，到期: ${vipExpireAt || (vipType === 'vip_lifetime' ? '永久' : '普通用户')}，邮件: ${emailRes.status}`
    )

    res.json({
      success: true,
      id: newId,
      tempPassword,
      resetLink,
      vipExpireAt,
      emailStatus: emailRes.status,
      errorMsg: emailRes.errorMsg,
    })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// 8. Delete user
app.delete('/api/admin/users/:id', async (req, res) => {
  try {
    const { id } = req.params
    const adminUsername = (req as any).admin?.username || 'admin'
    const [rows] = await pool.query<any[]>('SELECT email, nickname FROM user_profile WHERE id = ? LIMIT 1;', [id])
    const targetEmail = rows[0]?.email || ''

    await pool.query('DELETE FROM user_course_progress WHERE user_id = ?;', [id])
    await pool.query('DELETE FROM user_favorites WHERE user_id = ?;', [id])
    await pool.query('DELETE FROM user_favorite_sentences WHERE user_id = ?;', [id])
    await pool.query('DELETE FROM reviews WHERE user_id = ?;', [id])
    await pool.query('DELETE FROM user_profile WHERE id = ?;', [id])

    await logAdminAudit(adminUsername, 'DELETE_USER', id, targetEmail, `删除用户 ${rows[0]?.nickname || id}`)
    res.json({ success: true })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ==================== Admin SMTP, Email Logs & Audit Logs ====================
app.get('/api/admin/smtp', async (_, res) => {
  try {
    const cfg = await getSmtpConfig()
    res.json({ ...cfg, pass: cfg.pass ? '********' : '' })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.put('/api/admin/smtp', async (req, res) => {
  try {
    const adminUsername = (req as any).admin?.username || 'admin'
    const body = { ...req.body }
    if (body.pass === '********' || body.pass === '') {
      delete body.pass
    }
    const saved = await saveSmtpConfig(body)
    await logAdminAudit(adminUsername, 'UPDATE_SMTP', '', '', `更新邮件服务配置 (enabled=${saved.enabled})`)
    res.json({ success: true, config: { ...saved, pass: saved.pass ? '********' : '' } })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.post('/api/admin/smtp/test', async (req, res) => {
  try {
    const { to } = req.body
    if (!to) return res.status(400).json({ error: '请输入收件测试邮箱' })
    const result = await sendSystemEmail({
      to,
      subject: '【研习岛】SMTP 邮件服务连通性测试',
      html: '<p>您好，这是一封来自研习岛独立后台的 SMTP 测试邮件。收到此邮件说明邮件配置已生效！</p>',
      textPreview: 'SMTP 测试邮件',
    })
    res.json({ success: result.status === 'sent', ...result })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.get('/api/admin/email-logs', async (_, res) => {
  try {
    const [rows] = await pool.query<any[]>('SELECT * FROM email_logs ORDER BY created_at DESC LIMIT 100;')
    res.json(rows)
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.get('/api/admin/audit-logs', async (_, res) => {
  try {
    const [rows] = await pool.query<any[]>('SELECT * FROM admin_audit_logs ORDER BY created_at DESC LIMIT 150;')
    res.json(rows)
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ==================== Admin VIP Upgrade Requests ====================
app.get('/api/admin/vip-requests', async (req, res) => {
  try {
    const statusFilter = String(req.query?.status || '').trim()
    let sql = 'SELECT * FROM vip_upgrade_requests'
    const params: any[] = []
    if (statusFilter && ['pending', 'replied', 'approved', 'rejected'].includes(statusFilter)) {
      sql += ' WHERE status = ?'
      params.push(statusFilter)
    }
    sql += ' ORDER BY updated_at DESC, created_at DESC LIMIT 200;'

    const [reqRows] = await pool.query<any[]>(sql, params)
    const requests = reqRows.map(formatVipRequestRow)

    const [pendingRows] = await pool.query<any[]>(
      "SELECT COUNT(*) AS cnt FROM vip_upgrade_requests WHERE status IN ('pending', 'replied');"
    )
    const pendingCount = Number(pendingRows[0]?.cnt || 0)

    const messagesMap: Record<string, any[]> = {}
    if (requests.length > 0) {
      const ids = requests.map(r => r.id)
      const placeholders = ids.map(() => '?').join(', ')
      const [msgRows] = await pool.query<any[]>(
        `SELECT * FROM vip_upgrade_messages WHERE request_id IN (${placeholders}) ORDER BY created_at ASC;`,
        ids
      )
      for (const m of msgRows) {
        const formatted = formatVipMessageRow(m)
        if (!messagesMap[formatted.requestId]) messagesMap[formatted.requestId] = []
        messagesMap[formatted.requestId].push(formatted)
      }
    }

    res.json({ requests, messagesMap, pendingCount })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.post('/api/admin/vip-requests/:id/reply', async (req, res) => {
  try {
    const adminUsername = (req as any).admin?.username || 'admin'
    const requestId = req.params.id
    const content = String(req.body?.content || '').trim()
    if (!content) return res.status(400).json({ error: '回复文本或支付链接不能为空' })
    if (content.length > 1500) return res.status(400).json({ error: '回复内容不能超过 1500 字' })

    const [rows] = await pool.query<any[]>('SELECT * FROM vip_upgrade_requests WHERE id = ? LIMIT 1;', [requestId])
    if (rows.length === 0) return res.status(404).json({ error: '升级申请不存在' })

    const current = rows[0]
    const nowStr = formatLocalDateTime(new Date())
    const msgId = `vmsg_${crypto.randomBytes(8).toString('hex')}`

    await pool.query(
      `INSERT INTO vip_upgrade_messages (id, request_id, sender_role, sender_name, content, created_at)
       VALUES (?, ?, 'admin', ?, ?, ?);`,
      [msgId, requestId, adminUsername, content, nowStr]
    )

    const nextStatus = current.status === 'pending' ? 'replied' : current.status
    await pool.query(
      'UPDATE vip_upgrade_requests SET status = ?, updated_at = ? WHERE id = ?;',
      [nextStatus, nowStr, requestId]
    )

    await logAdminAudit(
      adminUsername,
      'REPLY_VIP_REQUEST',
      current.user_id,
      current.user_email || '',
      `回复会员升级申请 ${requestId} (目标: ${current.target_vip_type})`
    )

    res.json({
      success: true,
      status: nextStatus,
      message: {
        id: msgId,
        requestId,
        senderRole: 'admin',
        senderName: adminUsername,
        content,
        createdAt: nowStr,
      },
    })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.put('/api/admin/vip-requests/:id/status', async (req, res) => {
  try {
    const adminUsername = (req as any).admin?.username || 'admin'
    const requestId = req.params.id
    const status = String(req.body?.status || '').trim()
    const note = String(req.body?.note || '').trim()

    if (!['approved', 'rejected', 'replied'].includes(status)) {
      return res.status(400).json({ error: '无效的审批状态' })
    }

    const [rows] = await pool.query<any[]>('SELECT * FROM vip_upgrade_requests WHERE id = ? LIMIT 1;', [requestId])
    if (rows.length === 0) return res.status(404).json({ error: '升级申请不存在' })

    const current = rows[0]
    const now = new Date()
    const nowStr = formatLocalDateTime(now)

    await pool.query(
      'UPDATE vip_upgrade_requests SET status = ?, updated_at = ? WHERE id = ?;',
      [status, nowStr, requestId]
    )

    if (note) {
      const msgId = `vmsg_${crypto.randomBytes(8).toString('hex')}`
      await pool.query(
        `INSERT INTO vip_upgrade_messages (id, request_id, sender_role, sender_name, content, created_at)
         VALUES (?, ?, 'admin', ?, ?, ?);`,
        [msgId, requestId, adminUsername, note, nowStr]
      )
    }

    if (status === 'approved') {
      const targetVip = current.target_vip_type as VipType
      const expireAt = calculateVipExpiration(targetVip, now)
      await pool.query(
        `UPDATE user_profile SET vip_type = ?, vip_expire_at = ?, role = 'VIP学员', has_ever_vip = 1, last_vip_type = ? WHERE id = ?;`,
        [targetVip, expireAt, targetVip, current.user_id]
      )
    }

    await logAdminAudit(
      adminUsername,
      status === 'approved' ? 'APPROVE_VIP_REQUEST' : status === 'rejected' ? 'REJECT_VIP_REQUEST' : 'UPDATE_VIP_REQUEST',
      current.user_id,
      current.user_email || '',
      `调整会员升级申请 ${requestId} 状态为 ${status} (目标: ${current.target_vip_type})`
    )

    res.json({ success: true, status, updatedAt: nowStr })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ==================== Course Sync & Offline Bundle Update System ====================
app.use('/api/sync', requireAdmin)

/**
 * 1. Get current database & content sync status
 */
app.get('/api/sync/status', async (_, res) => {
  try {
    const [courseRows] = await pool.query<any[]>("SELECT type, COUNT(*) as cnt FROM courses GROUP BY type;")
    const [lessonRows] = await pool.query<any[]>('SELECT COUNT(*) as cnt FROM lessons;')
    const [sentenceRows] = await pool.query<any[]>('SELECT COUNT(*) as cnt FROM sentences;')
    const [wordRows] = await pool.query<any[]>('SELECT COUNT(*) as cnt FROM words;')
    const [dictRows] = await pool.query<any[]>('SELECT COUNT(*) as cnt FROM tts_dictionary;')
    const [userRows] = await pool.query<any[]>('SELECT COUNT(*) as cnt FROM user_profile;')

    let coursesCount = 0
    let teachingCount = 0
    for (const r of courseRows) {
      if (r.type === 'teaching') teachingCount += Number(r.cnt || 0)
      else coursesCount += Number(r.cnt || 0)
    }

    let dbSizeBytes = 0
    try {
      if (DB_MODE === 'sqlite' && fs.existsSync(DB_FILE_PATH)) {
        dbSizeBytes = fs.statSync(DB_FILE_PATH).size
      }
    } catch {}

    res.json({
      engine: DB_MODE === 'mysql' ? 'MySQL (Remote/Server)' : 'SQLite (Embedded)',
      dbPath: DB_MODE === 'mysql' ? 'MySQL Pool' : DB_FILE_PATH,
      dbSizeBytes,
      contentVersion: await getSystemMeta('content_version', '2026.11.07.1'),
      lastSyncAt: await getSystemMeta('last_sync_at', ''),
      remoteSyncUrl: await getSystemMeta('remote_sync_url', ''),
      counts: {
        courses: coursesCount,
        teaching: teachingCount,
        totalCourses: coursesCount + teachingCount,
        lessons: Number(lessonRows[0]?.cnt || 0),
        sentences: Number(sentenceRows[0]?.cnt || 0),
        words: Number(wordRows[0]?.cnt || 0),
        ttsDict: Number(dictRows[0]?.cnt || 0),
        users: Number(userRows[0]?.cnt || 0),
      },
    })
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

/**
 * 2. Export public courses, lessons, sentences, categories, and TTS dictionary as a .yxdpack JSON bundle
 */
app.get('/api/sync/export', async (req, res) => {
  try {
    const courseIdsRaw = req.query.courseIds as string | undefined
    const courseIds = courseIdsRaw ? courseIdsRaw.split(',').map(s => s.trim()).filter(Boolean) : undefined
    const bundle = await exportCourseBundle({ courseIds })
    res.json(bundle)
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message })
  }
})

/**
 * 3. Import / Upsert a .yxdpack course bundle into database without touching personal user records
 */
app.post('/api/sync/import', async (req, res) => {
  try {
    const payload = req.body?.bundle ? req.body.bundle : req.body
    const updateBuiltinSnapshot = req.body?.updateBuiltinSnapshot !== false
    const result = await importCourseBundle(payload, { updateBuiltinSnapshot })
    res.json({
      ...result,
      message: `题库热更新成功！已增量合并 ${result.imported.courses} 门课程/教辅、${result.imported.lessons} 个小节、${result.imported.sentences} 条精听句子（学员个人学习记录与打卡数据 100% 完好保留）。`,
    })
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: (err as Error).message })
  }
})

/**
 * 4. Save remote sync URL configuration
 */
app.put('/api/sync/config', async (req, res) => {
  try {
    const { remoteSyncUrl } = req.body
    const trimmed = (remoteSyncUrl || '').trim()
    if (trimmed) {
      await assertSafeRemoteUrl(trimmed)
    }
    await setSystemMeta('remote_sync_url', trimmed)
    res.json({ success: true, remoteSyncUrl: trimmed })
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message })
  }
})

/**
 * 5. Pull latest course bundle from a remote URL (Web server or OSS static bundle) and upsert locally
 */
app.post('/api/sync/remote', async (req, res) => {
  try {
    const savedUrl = await getSystemMeta('remote_sync_url', '')
    const rawUrl = (req.body?.remoteUrl ?? savedUrl).trim()
    if (!rawUrl) {
      return res.status(400).json({ success: false, error: '请先填写有效的云端题库同步地址 (URL)' })
    }

    let targetUrl = rawUrl
    if (!/\.(json|yxdpack)(\?.*)?$/i.test(targetUrl) && !targetUrl.includes('/api/sync/export')) {
      targetUrl = targetUrl.replace(/\/+$/, '') + '/api/sync/export'
    }

    await assertSafeRemoteUrl(targetUrl)
    await setSystemMeta('remote_sync_url', rawUrl)

    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(30000),
    })

    if (!response.ok) {
      return res.status(502).json({
        success: false,
        error: `远程题库服务器响应异常 (HTTP ${response.status} ${response.statusText})`,
      })
    }

    const bundle = await response.json()
    const result = await importCourseBundle(bundle, { updateBuiltinSnapshot: false })

    res.json({
      ...result,
      remoteUrl: rawUrl,
      message: `云端同步成功（版本号 ${result.contentVersion}）！已同步 ${result.imported.courses} 门课程/教辅、${result.imported.lessons} 个小节、${result.imported.sentences} 条句子。`,
    })
  } catch (err: unknown) {
    res.status(500).json({
      success: false,
      error: `无法连接云端题库源：${(err as Error).message}`,
    })
  }
})

// ==================== Static Frontend & Public Assets Hosting ====================
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public')
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR))
}

const DIST_DIR = path.join(PROJECT_ROOT, 'dist')
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR))
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) return next()
    const indexHtml = path.join(DIST_DIR, 'index.html')
    if (fs.existsSync(indexHtml)) {
      res.sendFile(indexHtml)
    } else {
      next()
    }
  })
}

let activeServer: Server | null = null

export async function startServer(listenPort: number = port, host = '127.0.0.1'): Promise<{ server: Server; port: number }> {
  await initDatabase()
  return new Promise((resolve, reject) => {
    const srv = app.listen(listenPort, host, () => {
      activeServer = srv
      const addr = srv.address()
      const actualPort = typeof addr === 'object' && addr ? addr.port : listenPort
      console.log(`🚀 YanXiDao Server (SQLite Embedded) running at http://${host}:${actualPort}`)
      resolve({ server: srv, port: actualPort })
    })
    srv.on('error', err => {
      reject(err)
    })
  })
}

export async function stopServer(): Promise<void> {
  if (activeServer) {
    await new Promise<void>(resolve => {
      activeServer!.close(() => resolve())
    })
    activeServer = null
  }
  pool.close()
}

// Auto-start when executed directly via `tsx server/index.ts` or `node ...`
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)
if (isDirectRun) {
  startServer(port, '0.0.0.0').catch(err => {
    console.error('Failed to start YanXiDao server:', err)
    process.exit(1)
  })
}
