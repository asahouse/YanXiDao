import nodemailer from 'nodemailer'
import { pool, getSystemMeta, setSystemMeta } from './db'
import { VIP_TYPE_INFO, type VipType } from '../src/utils/levelRules'

export interface SmtpConfig {
  enabled: boolean
  host: string
  port: number
  secure: boolean
  user: string
  pass: string
  fromName: string
  fromEmail: string
}

const DEFAULT_SMTP: SmtpConfig = {
  enabled: false,
  host: process.env.SMTP_HOST || '',
  port: Number(process.env.SMTP_PORT || 465),
  secure: true,
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  fromName: '研习岛 YanXiDao',
  fromEmail: process.env.SMTP_USER || 'noreply@yanxidao.com',
}

export async function getSmtpConfig(): Promise<SmtpConfig> {
  try {
    const raw = await getSystemMeta('smtp_config')
    if (raw) {
      return { ...DEFAULT_SMTP, ...JSON.parse(raw) }
    }
  } catch {}
  return DEFAULT_SMTP
}

export async function saveSmtpConfig(cfg: Partial<SmtpConfig>): Promise<SmtpConfig> {
  const current = await getSmtpConfig()
  const next: SmtpConfig = { ...current, ...cfg }
  await setSystemMeta('smtp_config', JSON.stringify(next))
  return next
}

interface SendEmailOptions {
  to: string
  subject: string
  html: string
  textPreview: string
  tempPassword?: string
  resetLink?: string
}

export async function sendSystemEmail(opts: SendEmailOptions): Promise<{ status: 'sent' | 'simulated' | 'failed'; errorMsg?: string }> {
  const cfg = await getSmtpConfig()
  const logId = `mail_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`

  let status: 'sent' | 'simulated' | 'failed' = 'simulated'
  let errorMsg = ''

  if (cfg.enabled && cfg.host && cfg.user && cfg.pass) {
    try {
      const transporter = nodemailer.createTransport({
        host: cfg.host,
        port: Number(cfg.port) || 465,
        secure: Boolean(cfg.secure),
        auth: {
          user: cfg.user,
          pass: cfg.pass,
        },
      })
      await transporter.sendMail({
        from: `"${cfg.fromName || '研习岛'}" <${cfg.fromEmail || cfg.user}>`,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
      })
      status = 'sent'
    } catch (err: unknown) {
      status = 'failed'
      errorMsg = (err as Error).message || 'SMTP send failed'
      console.error('[EmailService] SMTP error:', errorMsg)
    }
  } else {
    status = 'simulated'
    console.log(`[EmailService] (Simulated Outbox) To: ${opts.to} | Subject: ${opts.subject} | TempPwd: ${opts.tempPassword || '-'} | Link: ${opts.resetLink || '-'}`)
  }

  try {
    await pool.query(
      `INSERT INTO email_logs (id, recipient, subject, content_preview, temp_password, reset_link, status, error_msg)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        logId,
        opts.to,
        opts.subject,
        opts.textPreview,
        opts.tempPassword || '',
        opts.resetLink || '',
        status,
        errorMsg,
      ]
    )
  } catch (err) {
    console.error('[EmailService] Failed to save email log:', err)
  }

  return { status, errorMsg: errorMsg || undefined }
}

export async function sendAccountProvisionEmail(params: {
  email: string
  nickname: string
  tempPassword: string
  resetLink: string
  vipType: VipType
  vipExpireAt?: string | null
  isReset?: boolean
}) {
  const vipLabel = VIP_TYPE_INFO[params.vipType]?.label || '普通用户'
  const expireDesc =
    params.vipType === 'free'
      ? '每日享当前等级对应免费时长'
      : params.vipType === 'vip_lifetime'
      ? '永久有效（无限畅学）'
      : `有效期至 ${params.vipExpireAt || '-'}`

  const subject = params.isReset
    ? '【研习岛】您的登录密码已重置，请查收临时密码'
    : '【研习岛】欢迎加入研习岛！您的账号与会员权益已开通'

  const heading = params.isReset ? '账号密码重置通知' : '欢迎加入研习岛（YanXiDao）'

  const html = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 28px; background: #0f172a; color: #f8fafc; border-radius: 16px; border: 1px solid #1e293b;">
      <h2 style="margin: 0 0 12px; color: #818cf8;">${heading}</h2>
      <p style="color: #cbd5e1; line-height: 1.6;">您好，<strong>${params.nickname}</strong>：</p>
      <p style="color: #cbd5e1; line-height: 1.6;">
        ${params.isReset ? '管理员已为您重置登录密码。' : '您的研习岛学习账号已由管理员开通激活。'}
      </p>
      <div style="background: #1e293b; padding: 16px; border-radius: 12px; margin: 18px 0; border: 1px solid #334155;">
        <p style="margin: 6px 0; font-size: 14px;">登录邮箱：<strong style="color: #fff;">${params.email}</strong></p>
        <p style="margin: 6px 0; font-size: 14px;">8位临时密码：<strong style="color: #38bdf8; font-size: 18px; letter-spacing: 1px;">${params.tempPassword}</strong></p>
        <p style="margin: 6px 0; font-size: 14px;">会员类型：<strong style="color: #fbbf24;">${vipLabel}</strong>（${expireDesc}）</p>
      </div>
      <p style="color: #cbd5e1; line-height: 1.6;">为了您的账号安全，请点击下方按钮直接设置新密码（24小时内有效），也可使用上方临时密码登录后修改：</p>
      <div style="text-align: center; margin: 24px 0;">
        <a href="${params.resetLink}" style="display: inline-block; padding: 12px 28px; background: #4f46e5; color: #ffffff; text-decoration: none; font-weight: bold; border-radius: 10px;">
          立即修改密码并登录
        </a>
      </div>
      <p style="font-size: 12px; color: #64748b; word-break: break-all;">若按钮无法点击，请复制以下链接到浏览器打开：<br/>${params.resetLink}</p>
    </div>
  `

  const textPreview = `${vipLabel} (${expireDesc}) | 临时密码: ${params.tempPassword}`

  return sendSystemEmail({
    to: params.email,
    subject,
    html,
    textPreview,
    tempPassword: params.tempPassword,
    resetLink: params.resetLink,
  })
}
