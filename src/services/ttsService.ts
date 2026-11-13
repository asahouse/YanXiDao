import { get, set } from 'idb-keyval'
import type { WordToken } from '../types'

export interface TTSRequestOptions {
  text: string
  phonetic?: string
  words?: WordToken[]
  voice?: string
  speed?: number
  volume?: number
}

export interface VoiceProfile {
  id: string
  name: string
  gender: 'female' | 'male' | 'child'
  locale: 'en-US' | 'en-GB'
  pitch: number
  rateMultiplier: number
  nameKeywords: string[]
}

export const VOICE_PROFILES: Record<string, VoiceProfile> = {
  'en-US-AvaNeural': {
    id: 'en-US-AvaNeural',
    name: '美式超拟人女声 (Ava) - 推荐',
    gender: 'female',
    locale: 'en-US',
    pitch: 1.0,
    rateMultiplier: 1.0,
    nameKeywords: ['ava', 'jenny', 'aria', 'female'],
  },
  'en-US-AndrewNeural': {
    id: 'en-US-AndrewNeural',
    name: '美式超拟人男声 (Andrew) - 推荐',
    gender: 'male',
    locale: 'en-US',
    pitch: 1.0,
    rateMultiplier: 1.0,
    nameKeywords: ['andrew', 'guy', 'male'],
  },
  'en-US-JennyNeural': {
    id: 'en-US-JennyNeural',
    name: '美式经典女声 (Jenny) - 播音级',
    gender: 'female',
    locale: 'en-US',
    pitch: 1.0,
    rateMultiplier: 1.0,
    nameKeywords: ['jenny', 'aria', 'zira', 'samantha', 'google us english', 'female', 'susan', 'karen', 'victoria'],
  },
  'en-US-GuyNeural': {
    id: 'en-US-GuyNeural',
    name: '美式沉稳男声 (Guy) - 浑厚温和',
    gender: 'male',
    locale: 'en-US',
    pitch: 0.70, // Resonant, deep male pitch
    rateMultiplier: 0.96,
    nameKeywords: ['guy', 'david', 'mark', 'christopher', 'alex', 'richard', 'james', 'male'],
  },
  'en-US-EmmaNeural': {
    id: 'en-US-EmmaNeural',
    name: '美式知性女声 (Emma) - 清透自然',
    gender: 'female',
    locale: 'en-US',
    pitch: 1.0,
    rateMultiplier: 1.0,
    nameKeywords: ['emma', 'female'],
  },
  'en-US-ChristopherNeural': {
    id: 'en-US-ChristopherNeural',
    name: '美式商务男声 (Christopher) - 端庄稳重',
    gender: 'male',
    locale: 'en-US',
    pitch: 0.95,
    rateMultiplier: 0.98,
    nameKeywords: ['christopher', 'male'],
  },
  'en-GB-SoniaNeural': {
    id: 'en-GB-SoniaNeural',
    name: '英式优雅女声 (Sonia) - 标准英音',
    gender: 'female',
    locale: 'en-GB',
    pitch: 1.12, // Crisp British female pitch
    rateMultiplier: 0.98,
    nameKeywords: ['sonia', 'libby', 'hazel', 'google uk english female', 'uk english female', 'female', 'fiona'],
  },
  'en-GB-RyanNeural': {
    id: 'en-GB-RyanNeural',
    name: '英式绅士男声 (Ryan) - 磁性英伦',
    gender: 'male',
    locale: 'en-GB',
    pitch: 0.72, // Deep British male pitch
    rateMultiplier: 0.95,
    nameKeywords: ['ryan', 'george', 'oliver', 'daniel', 'google uk english male', 'uk english male', 'male'],
  },
  'en-GB-LibbyNeural': {
    id: 'en-GB-LibbyNeural',
    name: '英式现代女声 (Libby) - 自然流畅',
    gender: 'female',
    locale: 'en-GB',
    pitch: 1.0,
    rateMultiplier: 1.0,
    nameKeywords: ['libby', 'female'],
  },
  'en-US-AnaNeural': {
    id: 'en-US-AnaNeural',
    name: '灵动童声 (Ana) - 活泼纯真',
    gender: 'child',
    locale: 'en-US',
    pitch: 1.55, // Bright, youthful child pitch
    rateMultiplier: 1.08,
    nameKeywords: ['ana', 'child', 'kid', 'girl', 'maia', 'junior'],
  },
}

function toSafeNumber(val: any, fallback: number, min: number, max: number): number {
  if (val === undefined || val === null) return fallback
  const num = Number(val)
  if (isNaN(num) || !isFinite(num)) return fallback
  return Math.max(min, Math.min(max, num))
}

const activeUtterances = new Set<SpeechSynthesisUtterance>()

class TTSService {
  private correctionDictionary: Map<string, { ipa?: string; alias?: string }> = new Map([
    ['iphone', { alias: 'I phone' }],
    ['unesco', { ipa: 'juːˈnɛskoʊ' }],
    ['yanxidao', { alias: 'yan xi island' }],
  ])

  public currentUtterance: SpeechSynthesisUtterance | null = null
  private currentAudio: HTMLAudioElement | null = null
  public isSynthesizing = false
  private availableVoices: SpeechSynthesisVoice[] = []

  constructor() {
    this.initVoices()
  }

  private initVoices() {
    if (typeof window === 'undefined' || !window.speechSynthesis) return

    const load = () => {
      const v = window.speechSynthesis.getVoices()
      if (v && v.length > 0) {
        this.availableVoices = v
      }
    }

    load()
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = load
    }
  }

  public async getVoicesAsync(): Promise<SpeechSynthesisVoice[]> {
    if (typeof window === 'undefined' || !window.speechSynthesis) return []
    if (this.availableVoices && this.availableVoices.length > 0) {
      return this.availableVoices
    }
    const immediate = window.speechSynthesis.getVoices()
    if (immediate && immediate.length > 0) {
      this.availableVoices = immediate
      return immediate
    }

    return new Promise((resolve) => {
      let resolved = false
      const onVoices = () => {
        if (resolved) return
        resolved = true
        const voices = window.speechSynthesis.getVoices()
        this.availableVoices = voices
        resolve(voices)
      }

      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = onVoices
      }
      setTimeout(() => {
        if (!resolved) {
          resolved = true
          this.availableVoices = window.speechSynthesis.getVoices()
          resolve(this.availableVoices)
        }
      }, 250)
    })
  }

  private selectBestVoice(profile: VoiceProfile): SpeechSynthesisVoice | null {
    const voices = this.availableVoices
    if (!voices || voices.length === 0) return null

    const isMaleRequested = profile.gender === 'male'
    const isFemaleRequested = profile.gender === 'female'

    const isMaleVoice = (v: SpeechSynthesisVoice): boolean => {
      const n = v.name.toLowerCase()
      if (n.includes('female')) return false
      return n.includes('male') || n.includes('david') || n.includes('guy') || n.includes('mark') ||
             n.includes('george') || n.includes('ryan') || n.includes('christopher') || n.includes('alex')
    }

    const isFemaleVoice = (v: SpeechSynthesisVoice): boolean => {
      const n = v.name.toLowerCase()
      return n.includes('female') || n.includes('zira') || n.includes('jenny') || n.includes('aria') ||
             n.includes('samantha') || n.includes('sonia') || n.includes('libby') || n.includes('hazel')
    }

    // 1. Try exact keyword matching in preferred order (strictly preventing gender conflicts)
    for (const kw of profile.nameKeywords) {
      const match = voices.find(v => {
        const n = v.name.toLowerCase()
        if (isMaleRequested && isFemaleVoice(v)) return false
        if (isFemaleRequested && isMaleVoice(v)) return false
        if (kw === 'male') {
          return isMaleVoice(v)
        }
        return n.includes(kw)
      })
      if (match) return match
    }

    // 2. Try locale matching with strict gender filtering
    const localeVoices = voices.filter(v => 
      v.lang.toLowerCase().replace('_', '-').startsWith(profile.locale.toLowerCase())
    )

    if (localeVoices.length > 0) {
      if (isMaleRequested) {
        const maleVoice = localeVoices.find(v => isMaleVoice(v))
        if (maleVoice) return maleVoice
        const nonFemale = localeVoices.find(v => !isFemaleVoice(v))
        if (nonFemale) return nonFemale
      } else if (isFemaleRequested) {
        const femaleVoice = localeVoices.find(v => isFemaleVoice(v))
        if (femaleVoice) return femaleVoice
      }
      return localeVoices[0]
    }

    // 3. Fallback to any English voice with gender preference
    const anyEnglish = voices.filter(v => v.lang.toLowerCase().startsWith('en'))
    if (anyEnglish.length > 0) {
      if (isMaleRequested) {
        const maleVoice = anyEnglish.find(v => isMaleVoice(v))
        if (maleVoice) return maleVoice
      } else if (isFemaleRequested) {
        const femaleVoice = anyEnglish.find(v => isFemaleVoice(v))
        if (femaleVoice) return femaleVoice
      }
      return anyEnglish[0]
    }

    return null
  }

  public addCorrection(word: string, rule: { ipa?: string; alias?: string }) {
    this.correctionDictionary.set(word.toLowerCase().trim(), rule)
  }

  public getCorrection(word: string) {
    return this.correctionDictionary.get(word.toLowerCase().trim())
  }

  public stop() {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel()
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume()
        }
      } catch (e) {
        console.warn('SpeechSynthesis cancel error:', e)
      }
    }
    if (this.currentAudio) {
      try {
        this.currentAudio.pause()
        this.currentAudio.currentTime = 0
      } catch {}
      this.currentAudio = null
    }
    this.isSynthesizing = false
  }

  public async speak(options: TTSRequestOptions): Promise<void> {
    this.stop()

    // Read user saved defaults if options omit them
    let userDefaultVoice = 'en-US-JennyNeural'
    let userDefaultSpeed = 1.0
    let userDefaultVolume = 1.0

    try {
      const raw = localStorage.getItem('tqd_settings')
      if (raw) {
        const s = JSON.parse(raw)
        if (s?.pronunciation?.voice) userDefaultVoice = s.pronunciation.voice
        if (s?.pronunciation?.speed) userDefaultSpeed = Number(s.pronunciation.speed)
        if (s?.pronunciation?.volume !== undefined) userDefaultVolume = Number(s.pronunciation.volume) / 100
      }
    } catch {}

    const text = options.text
    const words = options.words
    const voiceKey = options.voice || userDefaultVoice
    const speed = toSafeNumber(options.speed, toSafeNumber(userDefaultSpeed, 1.0, 0.5, 2.0), 0.5, 2.0)
    const volume = toSafeNumber(options.volume, toSafeNumber(userDefaultVolume, 1.0, 0, 1.0), 0, 1.0)

    if (!text || !text.trim()) return

    const profile = VOICE_PROFILES[voiceKey] || VOICE_PROFILES['en-US-JennyNeural']

    const cacheKey = `tts_${text.trim().toLowerCase()}_${speed}_${voiceKey}`

    try {
      const cachedBlob = await get<Blob>(cacheKey)
      if (cachedBlob) {
        await this.playAudioBlob(cachedBlob, speed, volume)
        return
      }
    } catch {
      // Fallback
    }

    // Ensure browser voices are loaded
    await this.getVoicesAsync()

    // Small delay to allow cancel to complete in Chromium before speaking
    await new Promise(r => setTimeout(r, 35))

    // Pre-process text using dictionary substitutions
    let processedText = text
    if (words && words.length > 0) {
      words.forEach(w => {
        const corr = this.getCorrection(w.word)
        if (corr?.alias) {
          processedText = processedText.replace(new RegExp(`\\b${w.word}\\b`, 'gi'), corr.alias)
        }
      })
    }

    // Priority 1: High-fidelity Edge Neural TTS (ultra human-like, studio quality)
    try {
      const neuralSuccess = await this.playNeuralAudio(processedText, voiceKey, speed, volume)
      if (neuralSuccess) {
        return
      }
    } catch (e) {
      console.warn('[TTS] Neural audio failed, falling back to local speech synthesis:', e)
    }

    // Priority 2: Fallback to browser SpeechSynthesis
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !window.speechSynthesis) {
        this.playOnlineAudio(processedText, profile.locale === 'en-GB' ? 1 : 2, volume).then(resolve)
        return
      }

      // Ensure synthesizer is unpaused
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume()
      }

      const utterance = new SpeechSynthesisUtterance(processedText)
      utterance.volume = volume
      utterance.rate = Math.max(0.5, Math.min(2.0, speed * profile.rateMultiplier))
      utterance.pitch = toSafeNumber(profile.pitch, 1.0, 0.5, 2.0)

      // Match actual system/online voice
      const matchedVoice = this.selectBestVoice(profile)
      if (matchedVoice) {
        utterance.voice = matchedVoice
        utterance.lang = matchedVoice.lang || profile.locale
      } else {
        utterance.lang = profile.locale
        const fallbackVoice = this.availableVoices.find(v => v.lang.toLowerCase().startsWith('en')) || this.availableVoices[0]
        if (fallbackVoice) {
          utterance.voice = fallbackVoice
        }
      }

      let settled = false
      const done = () => {
        if (settled) return
        settled = true
        activeUtterances.delete(utterance)
        this.currentUtterance = null
        this.isSynthesizing = false
        resolve()
      }

      utterance.onstart = () => {
        this.isSynthesizing = true
      }

      utterance.onend = () => {
        done()
      }

      utterance.onerror = async (err) => {
        console.warn('SpeechSynthesis error, falling back to online audio:', err)
        try {
          await this.playOnlineAudio(text, profile.locale === 'en-GB' ? 1 : 2, volume)
        } catch {}
        done()
      }

      // Guard against stuck synthesizer
      const maxDuration = Math.max(3500, processedText.length * 350)
      setTimeout(() => {
        if (!settled && this.currentUtterance === utterance) {
          done()
        }
      }, maxDuration)

      activeUtterances.add(utterance)
      this.currentUtterance = utterance
      this.isSynthesizing = true

      try {
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume()
        }
        window.speechSynthesis.speak(utterance)
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume()
        }
      } catch (e) {
        console.warn('Failed to call window.speechSynthesis.speak:', e)
        this.playOnlineAudio(text, profile.locale === 'en-GB' ? 1 : 2, volume).then(done)
      }
    })
  }

  public async playNeuralAudio(text: string, voiceKey: string, speed = 1.0, volume = 1.0): Promise<boolean> {
    const clean = text.trim()
    if (!clean) return false
    try {
      const url = `/api/tts?text=${encodeURIComponent(clean)}&voice=${encodeURIComponent(voiceKey)}&speed=${speed}`
      return await new Promise((resolve) => {
        const audio = new Audio(url)
        this.currentAudio = audio
        audio.volume = Math.max(0, Math.min(1.0, volume))
        this.isSynthesizing = true

        let settled = false
        const finish = (result: boolean) => {
          if (settled) return
          settled = true
          if (this.currentAudio === audio) {
            this.currentAudio = null
            this.isSynthesizing = false
          }
          resolve(result)
        }

        audio.onended = () => finish(true)
        audio.onerror = () => finish(false)
        audio.play().catch(() => finish(false))
      })
    } catch {
      return false
    }
  }

  public async playOnlineAudio(text: string, type: 1 | 2 = 2, volume = 1.0): Promise<void> {
    return new Promise((resolve) => {
      try {
        const clean = text.replace(/[^a-zA-Z0-9\s'-]/g, ' ').trim()
        if (!clean) return resolve()
        const words = clean.split(/\s+/)
        const query = words.slice(0, 3).join(' ')
        const url = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(query)}&type=${type}`
        const audio = new Audio(url)
        audio.volume = Math.max(0, Math.min(1.0, volume))
        this.currentAudio = audio
        audio.onended = () => {
          this.currentAudio = null
          resolve()
        }
        audio.onerror = () => {
          this.currentAudio = null
          resolve()
        }
        audio.play().catch(() => {
          this.currentAudio = null
          resolve()
        })
      } catch {
        resolve()
      }
    })
  }

  private async playAudioBlob(blob: Blob, speed: number, volume: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      this.currentAudio = audio
      audio.playbackRate = speed
      audio.volume = Math.max(0, Math.min(1, volume))

      audio.onended = () => {
        URL.revokeObjectURL(url)
        this.currentAudio = null
        resolve()
      }
      audio.onerror = (e) => {
        URL.revokeObjectURL(url)
        this.currentAudio = null
        reject(e)
      }
      audio.play().catch(reject)
    })
  }

  public async cacheAudio(text: string, blob: Blob, voice = 'en-US', speed = 1.0) {
    const cacheKey = `tts_${text.trim().toLowerCase()}_${speed}_${voice}`
    try {
      await set(cacheKey, blob)
    } catch {
      // Ignored
    }
  }
}

export const ttsService = new TTSService()
