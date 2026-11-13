import { defineStore } from 'pinia'
import type { AppSettings } from '../types'

const DEFAULT_SETTINGS: AppSettings = {
  pronunciation: {
    voice: 'en-US-AvaNeural',
    autoReadOnSwitch: true,
    autoReadOnCorrect: true,
    repeatCount: 1,
    repeatIntervalSeconds: 1,
    speed: 1.0,
    volume: 100,
  },
  sound: {
    typing: { enabled: true, type: 'default', volume: 80 },
    switchQuestion: { enabled: true, type: 'default', volume: 80 },
    answerCorrect: { enabled: true, type: 'default', volume: 90 },
    answerError: { enabled: true, type: 'default', volume: 80 },
    courseCompleted: { enabled: true, type: 'default', volume: 100 },
  },
  answer: {
    autoNextOnCorrect: true,
    autoAdvanceGrid: true,
    resetOnModeSwitch: true,
    autoShowAnswerModal: false,
    errorThresholdForAnswer: 3,
  },
  personalization: {
    inputTextColor: '#38bdf8',
    practiceTextColor: '#ffffff',
    practiceBgColor: '#0a0c13',
    cardBgColor: '#181c2b',
    confettiEnabled: true,
    fontSizeInput: 'default',
    fontSizeResult: 'default',
    theme: 'dark',
  },
}

export function deepMerge<T extends Record<string, any>>(target: T, source: any): T {
  if (!source || typeof source !== 'object') return target
  const output: any = { ...target }
  for (const key of Object.keys(source)) {
    if (source[key] !== undefined && source[key] !== null) {
      if (typeof source[key] === 'object' && !Array.isArray(source[key]) && target[key] && typeof target[key] === 'object') {
        output[key] = deepMerge(target[key], source[key])
      } else {
        output[key] = source[key]
      }
    }
  }
  return output as T
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null

export const useSettingsStore = defineStore('settings', {
  state: (): { settings: AppSettings; isHydrating: boolean } => {
    let saved: any = null
    try {
      const json = localStorage.getItem('tqd_settings')
      if (json) {
        saved = JSON.parse(json)
        if (saved?.personalization?.theme === 'light' && typeof document !== 'undefined') {
          document.documentElement.classList.add('light')
          document.documentElement.setAttribute('data-theme', 'light')
        }
      }
    } catch {
      // Ignored
    }
    return {
      settings: deepMerge(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), saved),
      isHydrating: false,
    }
  },
  actions: {
    async fetchSettings() {
      this.isHydrating = true
      try {
        const res = await fetch('/api/user/settings')
        if (res.ok) {
          const data = await res.json()
          if (data && typeof data === 'object') {
            this.settings = deepMerge(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), data)
            try {
              localStorage.setItem('tqd_settings', JSON.stringify(this.settings))
            } catch {}
          }
        }
      } catch (err) {
        console.error('Failed to fetch user settings:', err)
      } finally {
        this.applyCSSVariables()
        this.isHydrating = false
      }
    },
    async save() {
      try {
        localStorage.setItem('tqd_settings', JSON.stringify(this.settings))
      } catch {
        // Ignored
      }
      this.applyCSSVariables()
      try {
        await fetch('/api/user/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.settings),
        })
      } catch (err) {
        console.error('Failed to persist settings to DB:', err)
      }
    },
    debouncedSave() {
      if (this.isHydrating) return
      try {
        localStorage.setItem('tqd_settings', JSON.stringify(this.settings))
      } catch {
        // Ignored
      }
      this.applyCSSVariables()
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        this.save()
      }, 400)
    },
    async resetToDefault() {
      this.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS))
      await this.save()
    },
    toggleTheme() {
      const nextTheme = this.settings.personalization.theme === 'light' ? 'dark' : 'light'
      this.setTheme(nextTheme)
    },
    setTheme(theme: 'dark' | 'light') {
      this.settings.personalization.theme = theme
      if (theme === 'light') {
        this.settings.personalization.practiceBgColor = '#f8fafc'
        this.settings.personalization.cardBgColor = '#ffffff'
        this.settings.personalization.practiceTextColor = '#0f172a'
        this.settings.personalization.inputTextColor = '#0284c7'
      } else {
        this.settings.personalization.practiceBgColor = '#0a0c13'
        this.settings.personalization.cardBgColor = '#181c2b'
        this.settings.personalization.practiceTextColor = '#ffffff'
        this.settings.personalization.inputTextColor = '#38bdf8'
      }
      this.applyCSSVariables()
      this.debouncedSave()
    },
    applyCSSVariables() {
      if (typeof document === 'undefined') return
      const root = document.documentElement
      const p = this.settings.personalization
      const isLight = p.theme === 'light'

      if (isLight) {
        root.classList.add('light')
        root.classList.remove('dark')
        root.setAttribute('data-theme', 'light')
        root.style.colorScheme = 'light'
      } else {
        root.classList.remove('light')
        root.classList.add('dark')
        root.setAttribute('data-theme', 'dark')
        root.style.colorScheme = 'dark'
      }

      root.style.setProperty('--user-input-color', p.inputTextColor)
      root.style.setProperty('--user-practice-text-color', p.practiceTextColor)
      root.style.setProperty('--user-practice-bg', p.practiceBgColor)
      root.style.setProperty('--user-card-bg', p.cardBgColor)

      const fontSizeMap = {
        min: '18px',
        small: '20px',
        default: '24px',
        medium: '28px',
        large: '32px',
        max: '38px',
      }
      root.style.setProperty('--user-font-size-input', fontSizeMap[p.fontSizeInput] || '24px')
      root.style.setProperty('--user-font-size-result', fontSizeMap[p.fontSizeResult] || '22px')
    },
  },
})
