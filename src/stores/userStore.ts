import { defineStore } from 'pinia'
import type { UserProfile, PurchaseRecord } from '../types'
import { getLevelInfo, isVipActive, getVipRemainingDays } from '../utils/levelRules'

const USER_TOKEN_KEY = 'yxd_user_token'

export const useUserStore = defineStore('user', {
  state: () => ({
    token: localStorage.getItem(USER_TOKEN_KEY) || '',
    profile: {
      id: '8723192',
      nickname: '本傑明 🤠',
      avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=yanxidao_benjamin',
      role: '普通用户',
      email: 'benjamin@yanxidao.com',
      status: 'active',
      totalStudySeconds: 0,
      todayStudySeconds: 0,
      monthStudySeconds: 0,
      totalSentenceCount: 0,
      todaySentenceCount: 0,
      continuousDays: 0,
      hasCheckedInToday: false,
      lastCheckinDate: null,
      exp: 0,
      level: 1,
      todayExp: 0,
      vipType: 'free',
      vipExpireAt: null,
      hasEverVip: false,
      lastVipType: null,
      todayUsedSeconds: 0,
      mustChangePassword: false,
    } as UserProfile,
    purchaseRecords: [] as PurchaseRecord[],
    showUserCenterModal: false,
    userCenterTab: 'info' as 'info' | 'level' | 'purchases',
    showForceChangePwdModal: false,
    disabledNotice: '',
    levelUpToast: '',
  }),
  getters: {
    isAuthenticated: (state) => Boolean(state.token),
    levelInfo: (state) => getLevelInfo(state.profile.exp || 0),
    vipActive(): boolean {
      return isVipActive(this.profile.vipType, this.profile.vipExpireAt)
    },
    hasGrayVipBadge(): boolean {
      return !this.vipActive && Boolean(this.profile.hasEverVip)
    },
    vipRemainingDays(): number | null {
      return getVipRemainingDays(this.profile.vipType, this.profile.vipExpireAt)
    },
    dailyQuotaSeconds(): number {
      return this.levelInfo.dailyQuotaSeconds
    },
    remainingFreeSeconds(): number {
      if (this.vipActive) return Infinity
      return Math.max(0, this.levelInfo.dailyQuotaSeconds - (this.profile.todayUsedSeconds || 0))
    },
    isFreeQuotaExhausted(): boolean {
      if (this.vipActive) return false
      return this.remainingFreeSeconds <= 0
    },
  },
  actions: {
    getAuthHeaders(): Record<string, string> {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (this.token) {
        headers['Authorization'] = `Bearer ${this.token}`
      }
      return headers
    },

    setSession(token: string, user: UserProfile, mustChangePassword = false) {
      this.token = token
      localStorage.setItem(USER_TOKEN_KEY, token)
      this.profile = user
      this.disabledNotice = ''
      if (mustChangePassword || user.mustChangePassword) {
        this.showForceChangePwdModal = true
      }
    },

    logout() {
      this.token = ''
      localStorage.removeItem(USER_TOKEN_KEY)
      this.showForceChangePwdModal = false
    },

    async login(email: string, password: string) {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || '登录失败')
      }
      this.setSession(data.token, data.user, data.mustChangePassword)
      return data
    },

    async demoLogin() {
      const res = await fetch('/api/auth/demo-login', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || '体验登录失败')
      }
      this.setSession(data.token, data.user, false)
      return data
    },

    async changePassword(oldPassword: string, newPassword: string) {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ oldPassword, newPassword, userId: this.profile.id }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || '密码修改失败')
      }
      this.profile.mustChangePassword = false
      this.showForceChangePwdModal = false
      return data
    },

    async resetByToken(token: string, newPassword: string) {
      const res = await fetch('/api/auth/reset-by-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || '密码重置失败')
      }
      this.setSession(data.token, data.user, false)
      return data
    },

    async fetchProfile() {
      try {
        const res = await fetch(`/api/user/profile?userId=${this.profile.id || '8723192'}`, {
          headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
        })
        if (res.status === 403) {
          const errData = await res.json().catch(() => ({}))
          if (errData.disabled) {
            this.disabledNotice = errData.error || '您的账号已被管理员停用'
            this.logout()
            return
          }
        }
        if (res.ok) {
          this.profile = await res.json()
          if (this.profile.mustChangePassword && this.token) {
            this.showForceChangePwdModal = true
          }
        }
      } catch (err) {
        console.error('Failed to fetch user profile:', err)
      }
    },

    async fetchPurchases() {
      try {
        const res = await fetch('/api/user/purchases')
        if (res.ok) {
          this.purchaseRecords = await res.json()
        }
      } catch (err) {
        console.error('Failed to fetch purchases:', err)
      }
    },

    async addStudySeconds(seconds = 1) {
      this.profile.totalStudySeconds += seconds
      this.profile.todayStudySeconds += seconds
      this.profile.monthStudySeconds += seconds
      if (!this.vipActive) {
        this.profile.todayUsedSeconds = (this.profile.todayUsedSeconds || 0) + seconds
      }
      try {
        const res = await fetch('/api/user/profile', {
          method: 'PUT',
          headers: this.getAuthHeaders(),
          body: JSON.stringify({ userId: this.profile.id || '8723192', addStudySeconds: seconds }),
        })
        if (res.ok) {
          const data = await res.json()
          if (data.profile) {
            this.profile = data.profile
          }
          if (data.leveledUp) {
            const info = getLevelInfo(this.profile.exp)
            this.levelUpToast = `🎉 恭喜升级至 Lv.${info.level}「${info.title}」！每日免费时长已延长至 ${info.dailyQuotaMinutes} 分钟`
          }
        }
      } catch (err) {
        console.error('Failed to update study seconds:', err)
      }
    },

    async recordSentenceCompleted() {
      this.profile.totalSentenceCount += 1
      this.profile.todaySentenceCount += 1
      try {
        const res = await fetch('/api/user/profile', {
          method: 'PUT',
          headers: this.getAuthHeaders(),
          body: JSON.stringify({ userId: this.profile.id || '8723192', addSentenceCount: 1 }),
        })
        if (res.ok) {
          const data = await res.json()
          if (data.profile) {
            this.profile = data.profile
          }
          if (data.leveledUp) {
            const info = getLevelInfo(this.profile.exp)
            this.levelUpToast = `🎉 恭喜升级至 Lv.${info.level}「${info.title}」！每日免费时长已延长至 ${info.dailyQuotaMinutes} 分钟`
          }
        }
      } catch (err) {
        console.error('Failed to update sentence count:', err)
      }
    },

    async updateNickname(name: string) {
      if (!name || !name.trim()) return
      const trimmed = name.trim().slice(0, 20)
      this.profile.nickname = trimmed
      try {
        await fetch('/api/user/profile', {
          method: 'PUT',
          headers: this.getAuthHeaders(),
          body: JSON.stringify({ userId: this.profile.id, nickname: trimmed }),
        })
      } catch (err) {
        console.error('Failed to update nickname:', err)
      }
    },

    async updateAvatar(avatarUrl: string) {
      this.profile.avatar = avatarUrl
      try {
        await fetch('/api/user/profile', {
          method: 'PUT',
          headers: this.getAuthHeaders(),
          body: JSON.stringify({ userId: this.profile.id, avatar: avatarUrl }),
        })
      } catch (err) {
        console.error('Failed to update avatar:', err)
      }
    },

    async resetDefaultAvatar() {
      const defaultAvatar = 'https://api.dicebear.com/7.x/identicon/svg?seed=default_grey'
      await this.updateAvatar(defaultAvatar)
    },

    async checkIn() {
      try {
        const res = await fetch('/api/user/checkin', {
          method: 'POST',
          headers: this.getAuthHeaders(),
          body: JSON.stringify({ userId: this.profile.id }),
        })
        if (res.ok) {
          const data = await res.json()
          this.profile.continuousDays = data.continuousDays
          this.profile.hasCheckedInToday = true
          this.profile.lastCheckinDate = data.lastCheckinDate
          if (data.exp !== undefined) this.profile.exp = data.exp
          if (data.level !== undefined) this.profile.level = data.level
          if (data.leveledUp) {
            const info = getLevelInfo(this.profile.exp)
            this.levelUpToast = `🎉 打卡升级至 Lv.${info.level}「${info.title}」！每日免费时长已延长至 ${info.dailyQuotaMinutes} 分钟`
          }
          return data
        }
      } catch (err) {
        console.error('Failed to execute daily checkin:', err)
      }
      return null
    },
  },
})
