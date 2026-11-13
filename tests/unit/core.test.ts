import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ImporterService } from '../../src/services/importerService'
import { useUserStore } from '../../src/stores/userStore'
import { DAILY_EXP_CAP, getLevelInfo, isVipActive, splitTextWithLinks } from '../../src/utils/levelRules'
import { splitTextWithLinks as splitLinks } from '../../src/utils/textLinks'

describe('ImporterService', () => {
  const svc = new ImporterService()

  it('parses valid TXT content into sentences and words', () => {
    const txt = '1|Good morning!|1:Good:早上好:/gʊd/;2:morning:早晨:/ˈmɔːrnɪŋ/'
    const res = svc.parseTxtContent(txt)
    expect(res.success).toBe(true)
    expect(res.sentences).toHaveLength(1)
    expect(res.sentences![0].sentenceEn).toBe('Good morning!')
    expect(res.sentences![0].words).toHaveLength(2)
    expect(res.sentences![0].words[0].word).toBe('Good')
  })

  it('rejects empty content, missing delimiters, and missing phonetics', () => {
    expect(svc.parseTxtContent('   ').success).toBe(false)
    expect(svc.parseTxtContent('1|Hello').success).toBe(false)
    expect(svc.parseTxtContent('abc|Hello|1:Hello:你好:/həˈləʊ/').success).toBe(false)
    expect(svc.parseTxtContent('1|Hello|1:Hello:你好:').success).toBe(false)
  })
})

describe('Shared Domain Rules', () => {
  it('computes level info and VIP active status', () => {
    expect(DAILY_EXP_CAP).toBe(1200)
    expect(getLevelInfo(0).level).toBe(1)
    expect(isVipActive('vip_lifetime', null)).toBe(true)
    expect(isVipActive('free', null)).toBe(false)
  })

  it('splits plain text and https links safely without HTML', () => {
    const segs = splitLinks('点击 https://yanxidao.com/pay?a=1 付款')
    expect(segs).toEqual([
      { text: '点击 ', isLink: false },
      { text: 'https://yanxidao.com/pay?a=1', isLink: true },
      { text: ' 付款', isLink: false },
    ])
  })
})

describe('useUserStore offline outbox & session kick', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    ;(globalThis as any).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, String(v)),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
    }
    setActivePinia(createPinia())
  })

  it('caps offline outbox queue at 100 events', () => {
    const userStore = useUserStore()
    for (let i = 0; i < 120; i++) {
      userStore.enqueueOfflineEvent({ eventId: `ev_${i}`, addSentenceCount: 1 })
    }
    const saved = JSON.parse(localStorage.getItem('yxd_sync_outbox') || '[]')
    expect(saved).toHaveLength(100)
    expect(saved[0].eventId).toBe('ev_20')
  })

  it('clears token and sets disabledNotice on handleSessionKicked', () => {
    const userStore = useUserStore()
    userStore.token = 'fake-token'
    localStorage.setItem('yxd_user_token', 'fake-token')
    userStore.handleSessionKicked('被顶号下线')
    expect(userStore.token).toBe('')
    expect(localStorage.getItem('yxd_user_token')).toBeNull()
    expect(userStore.disabledNotice).toBe('被顶号下线')
  })
})
