<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { useCourseStore } from '../stores/courseStore'
import { usePracticeStore, KEY_FINGER_MAP } from '../stores/practiceStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useReviewStore } from '../stores/reviewStore'
import { useUserStore } from '../stores/userStore'
import { ttsService } from '../services/ttsService'
import { soundService } from '../services/soundService'
import { userFetch } from '../utils/userApi'
import VirtualKeyboard from '../components/practice/VirtualKeyboard.vue'
import PracticeSettingsModal from '../components/modals/PracticeSettingsModal.vue'
import PersonalizationModal from '../components/modals/PersonalizationModal.vue'
import ContentsDrawer from '../components/modals/ContentsDrawer.vue'
import ReportModal from '../components/modals/ReportModal.vue'
import confetti from 'canvas-confetti'
import {
  ArrowLeft,
  Settings,
  ChevronDown,
  BookOpen,
  RotateCcw,
  Palette,
  AlertCircle,
  Maximize2,
  Clock,
  Volume2,
  Check,
  RefreshCw,
  X,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Star,
} from 'lucide-vue-next'
import type { PracticeMode } from '../types'

const route = useRoute()
const router = useRouter()
const courseStore = useCourseStore()
const practiceStore = usePracticeStore()
const settingsStore = useSettingsStore()
const reviewStore = useReviewStore()
const userStore = useUserStore()

const showModeDropdown = ref(false)

const courseId = computed(() => route.params.courseId as string)
const lessonId = computed(() => route.params.lessonId as string)

const currentLesson = computed(() => {
  return courseStore.getLessonById(lessonId.value) || courseStore.currentLesson
})

const currentSentence = computed(() => practiceStore.currentSentence)

// ----------------- Word-Level Practice State & Cross-word Continuous Input -----------------
interface PracticeWordToken {
  index: number
  raw: string
  cleanWord: string
  trailingPunct: string
  phonetic: string
  meaning: string
}

const activeWordIndex = ref(0)
const wordInputs = ref<string[]>([])
const completedSentenceIndices = ref<Set<number>>(new Set())

const sentenceWordList = computed<PracticeWordToken[]>(() => {
  if (!currentSentence.value) return []
  const sEn = currentSentence.value.sentenceEn?.trim() || ''
  if (!sEn) return []

  const rawTokens = sEn.split(/\s+/).filter(Boolean)
  const metaWords = currentSentence.value.words || []

  return rawTokens.map((raw, idx) => {
    const match = raw.match(/^([^a-zA-Z0-9']*?)([a-zA-Z0-9'\-]+)([^a-zA-Z0-9']*?)$/)
    const cleanWord = match ? match[2] : (raw.replace(/^[^a-zA-Z0-9']+|[^a-zA-Z0-9']+$/g, '') || raw)
    const trailingPunct = match ? match[3] : (raw.match(/[^a-zA-Z0-9']+$/)?.[0] || '')

    const meta = metaWords[idx] || metaWords.find(w => w.word.toLowerCase() === cleanWord.toLowerCase() || w.word.toLowerCase() === raw.toLowerCase())

    return {
      index: idx,
      raw,
      cleanWord,
      trailingPunct,
      phonetic: meta?.phonetic || '',
      meaning: meta?.meaning || '',
    }
  })
})

const isCurrentSentenceCompleted = computed(() => {
  if (practiceStore.isAnswerCorrect) return true
  if (practiceStore.mode === 'puzzle') {
    if (!currentSentence.value) return false
    const assembled = practiceStore.selectedPuzzleWords.map((t) => t.word).join(' ')
    const targetClean = currentSentence.value.sentenceEn.replace(/[?,.!]/g, '').trim()
    return assembled.toLowerCase() === targetClean.toLowerCase()
  }
  return sentenceWordList.value.length > 0 && sentenceWordList.value.every((_, i) => isWordCompleted(i))
})

function isPunctuation(char: string) {
  return /[?,.!;:'"\-]/.test(char)
}

function isWordCompleted(wIdx: number) {
  const w = sentenceWordList.value[wIdx]
  if (!w) return false
  const typed = wordInputs.value[wIdx] || ''
  return typed.toLowerCase() === w.raw.toLowerCase()
}

function initWordInputs() {
  activeWordIndex.value = 0
  const words = sentenceWordList.value
  wordInputs.value = words.map(() => '')
  practiceStore.userInput = ''
}

function selectWord(index: number) {
  if (practiceStore.isAnswerCorrect) return
  if (index >= 0 && index < sentenceWordList.value.length) {
    activeWordIndex.value = index
  }
}

const currentSplitWord = computed(() => {
  const words = sentenceWordList.value
  if (!words.length) return null
  const safeIdx = Math.min(Math.max(0, activeWordIndex.value), words.length - 1)
  return words[safeIdx] || null
})

function playWordTTS(word: PracticeWordToken | null) {
  if (!word) return
  ttsService.speak({
    text: word.cleanWord,
    phonetic: word.phonetic,
    speed: settingsStore.settings.pronunciation?.speed ?? 1.0,
    volume: (settingsStore.settings.pronunciation?.volume ?? 100) / 100,
    voice: settingsStore.settings.pronunciation?.voice ?? 'en-US-JennyNeural',
  })
}

function toggleSplitMode(isSplit: boolean) {
  practiceStore.isSplitMode = isSplit
  practiceStore.showToast(isSplit ? '已开启拆句练习（逐词单独输入）' : '已切换至整句练习')
}

const currentNextChar = computed(() => {
  if (practiceStore.isAnswerCorrect || !currentSentence.value) return ''
  const words = sentenceWordList.value
  if (!words.length) return ''

  const safeIdx = Math.min(activeWordIndex.value, words.length - 1)
  const curWord = words[safeIdx]
  if (!curWord) return ''

  const typed = wordInputs.value[safeIdx] || ''
  if (typed.length < curWord.raw.length) {
    return curWord.raw[typed.length] || ''
  }

  if (safeIdx < words.length - 1) {
    const nextW = words[safeIdx + 1]
    const nextTyped = wordInputs.value[safeIdx + 1] || ''
    return nextW.raw[nextTyped.length] || ''
  }

  return ''
})

const currentActiveFinger = computed(() => {
  const ch = currentNextChar.value.toLowerCase()
  if (!ch) return null
  return KEY_FINGER_MAP[ch] || null
})

// Formatted timer supporting both MM:SS and HH:MM:SS
const formattedTimer = computed(() => {
  const total = practiceStore.timerSeconds
  const hours = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
})

// Next lesson in current course
const nextLesson = computed(() => {
  const lessons = courseStore.getLessonsByCourseId(courseId.value).filter(l => (l.sentenceCount === undefined || l.sentenceCount > 0))
  const curIdx = lessons.findIndex(l => l.id === lessonId.value)
  if (curIdx >= 0 && curIdx < lessons.length - 1) {
    return lessons[curIdx + 1]
  }
  return null
})

// Real-time study time heartbeat, 30s idle detection, and daily free quota guard
let lastSyncStudySeconds = 0
let studyHeartbeatTimer: any = null
let lastActivityAt = Date.now()
let warnedTwoMinutes = false
const isIdlePaused = ref(false)
const showQuotaExhaustedModal = ref(false)
const pendingQuotaExhausted = ref(false)

function recordUserActivity() {
  lastActivityAt = Date.now()
  if (isIdlePaused.value && !document.hidden && !userStore.isFreeQuotaExhausted && !showLessonCompletedModal.value) {
    isIdlePaused.value = false
    practiceStore.startTimer()
  }
}

function handleVisibilityChange() {
  if (document.hidden) {
    syncStudySeconds(true)
    practiceStore.stopTimer()
  } else {
    lastActivityAt = Date.now()
    if (!userStore.isFreeQuotaExhausted && !showLessonCompletedModal.value && !showQuotaExhaustedModal.value) {
      isIdlePaused.value = false
      practiceStore.startTimer()
    }
  }
}

function checkFreeQuotaStatus() {
  if (userStore.vipActive) return false
  const rem = userStore.remainingFreeSeconds
  if (rem <= 120 && rem > 0 && !warnedTwoMinutes) {
    warnedTwoMinutes = true
    const nextLv = Math.min(30, userStore.levelInfo.level + 1)
    practiceStore.showToast(`今日免费研习时长不足 2 分钟，升至 Lv.${nextLv} 可再延长 3 分钟！`)
  }
  if (rem <= 0) {
    practiceStore.stopTimer()
    pendingQuotaExhausted.value = true
    return true
  }
  return false
}

function syncStudySeconds(force = false) {
  const currentTotal = practiceStore.timerSeconds
  const delta = Math.max(0, currentTotal - lastSyncStudySeconds)
  if (delta > 0) {
    lastSyncStudySeconds = currentTotal
    userStore.addStudySeconds(delta)
    saveCurrentProgress()
  } else if (force) {
    saveCurrentProgress()
  }
}

function startStudyHeartbeat() {
  if (studyHeartbeatTimer) clearInterval(studyHeartbeatTimer)
  lastActivityAt = Date.now()
  studyHeartbeatTimer = setInterval(() => {
    if (document.hidden || Date.now() - lastActivityAt > 30000) {
      if (!isIdlePaused.value) {
        isIdlePaused.value = true
        practiceStore.stopTimer()
        lastSyncStudySeconds = practiceStore.timerSeconds
      }
      return
    }
    syncStudySeconds(false)
    checkFreeQuotaStatus()
  }, 5000)
}

function stopStudyHeartbeat() {
  if (studyHeartbeatTimer) {
    clearInterval(studyHeartbeatTimer)
    studyHeartbeatTimer = null
  }
}

// Lesson Completed Modal & Auto Transition State
const showLessonCompletedModal = ref(false)
const autoNextCountdown = ref(3)
let countdownTimer: any = null

async function saveCurrentProgress() {
  if (!courseId.value || !lessonId.value) return
  const total = practiceStore.totalSentences
  const currentIdx = practiceStore.currentSentenceIndex
  const percent = total > 0 ? Math.min(100, Math.round(((currentIdx + 1) / total) * 100)) : 0
  const courseTitle = courseStore.currentCourse?.title || '英语课程'
  const lessonTitle = currentLesson.value?.titleCn || currentLesson.value?.titleEn || '当前课时'
  const lessonNumber = currentLesson.value?.lessonNumber || 1
  const userId = userStore.profile?.id || '8723192'

  const payload = {
    userId,
    courseId: courseId.value,
    lessonId: lessonId.value,
    sentenceIndex: currentIdx,
    totalSentences: total,
    progressPercent: percent,
    courseTitle,
    lessonTitle,
    lessonNumber,
    studySeconds: practiceStore.timerSeconds,
  }

  try {
    await userFetch('/api/user/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    })
  } catch (err) {
    console.error('Failed to save user progress:', err)
  }
}

// ----------------- Sentence Favorites State -----------------
const favoriteSentencesSet = ref<Set<string>>(new Set())

async function fetchUserFavoriteSentences() {
  try {
    const res = await userFetch(`/api/favorites/sentences`)
    if (res.ok) {
      const list = await res.json()
      favoriteSentencesSet.value = new Set(list.map((item: any) => item.sentenceEn))
    }
  } catch (err) {
    console.error('Failed to load favorite sentences:', err)
  }
}

const isCurrentSentenceFavorited = computed(() => {
  if (!currentSentence.value) return false
  return favoriteSentencesSet.value.has(currentSentence.value.sentenceEn)
})

async function toggleFavoriteCurrentSentence() {
  if (!currentSentence.value) return
  const sEn = currentSentence.value.sentenceEn
  const sCn = currentSentence.value.sentenceCn
  const courseTitle = courseStore.currentCourse?.title || '英语课程'
  const userId = userStore.profile?.id || '8723192'

  const wasFav = favoriteSentencesSet.value.has(sEn)
  if (wasFav) {
    favoriteSentencesSet.value.delete(sEn)
    practiceStore.showToast('已从已收藏句子移除')
  } else {
    favoriteSentencesSet.value.add(sEn)
    practiceStore.showToast('已成功收藏该句子（可在“我的收藏”查看）')
  }

  try {
    const res = await userFetch('/api/favorites/sentences/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sentenceEn: sEn,
        sentenceCn: sCn,
        courseTitle,
        userId,
      }),
    })
    if (res.ok) {
      const data = await res.json()
      if (typeof data.isFavorite === 'boolean') {
        if (data.isFavorite) {
          favoriteSentencesSet.value.add(sEn)
        } else {
          favoriteSentencesSet.value.delete(sEn)
        }
      }
    }
  } catch (err) {
    console.error('Failed to toggle sentence favorite:', err)
  }
}

let lastPlayedSentenceKey = ''
let sentenceTtsTimer: ReturnType<typeof setTimeout> | null = null

function playCurrentSentenceTTS(force = false) {
  if (!currentSentence.value) return
  const currentKey = `${currentSentence.value.sentenceEn}_${practiceStore.currentSentenceIndex}`
  if (!force && lastPlayedSentenceKey === currentKey) {
    return
  }
  lastPlayedSentenceKey = currentKey

  if (sentenceTtsTimer) clearTimeout(sentenceTtsTimer)
  // Minimal delay (35ms) to ensure component reactive updates are finalized, then play immediately
  sentenceTtsTimer = setTimeout(() => {
    playSentenceTTS()
  }, 35)
}

async function loadCurrentLesson(id: string) {
  if (countdownTimer) clearInterval(countdownTimer)
  showLessonCompletedModal.value = false

  // Unpause synthesis if suspended
  if (typeof window !== 'undefined' && window.speechSynthesis && window.speechSynthesis.paused) {
    try {
      window.speechSynthesis.resume()
    } catch {}
  }

  // Fast start with cache if available
  const cachedLesson = courseStore.lessons.find(l => l.id === id)
  if (cachedLesson && cachedLesson.sentences && cachedLesson.sentences.length > 0) {
    practiceStore.startPractice(cachedLesson, 0, practiceStore.timerSeconds)
    initWordInputs()
    playCurrentSentenceTTS(true)
  }

  // Concurrently fetch lesson, course details, and saved progress
  const [lesson] = await Promise.all([
    courseStore.fetchLesson(id),
    courseId.value ? courseStore.fetchCourseDetails(courseId.value) : Promise.resolve(null),
  ])

  if (lesson && lesson.sentences && lesson.sentences.length > 0) {
    let initialIdx = 0
    let savedStudySeconds = 0

    // Restore from personal progress record for this course
    try {
      const res = await userFetch(`/api/user/progress?courseId=${courseId.value}`)
      if (res.ok) {
        const p = await res.json()
        if (p) {
          if (p.studySeconds !== undefined && p.studySeconds !== null) {
            savedStudySeconds = Number(p.studySeconds) || 0
          }
          if (route.query.sentence === undefined && p.lessonId === id && p.sentenceIndex > 0 && p.sentenceIndex < lesson.sentences.length) {
            initialIdx = p.sentenceIndex
            practiceStore.showToast(`已为您恢复上次练习进度（第 ${initialIdx + 1}/${lesson.sentences.length} 题）`)
          }
        }
      }
    } catch (err) {
      console.error('Failed to load user course progress:', err)
    }

    if (route.query.sentence !== undefined) {
      const qIdx = parseInt(route.query.sentence as string, 10)
      if (!isNaN(qIdx) && qIdx >= 0 && qIdx < lesson.sentences.length) {
        initialIdx = qIdx
      }
    }

    practiceStore.startPractice(lesson, initialIdx, savedStudySeconds)
    lastSyncStudySeconds = savedStudySeconds
    startStudyHeartbeat()
    initWordInputs()
    // 初始化本课已完成句子集合
    completedSentenceIndices.value.clear()
    for (let i = 0; i < initialIdx; i++) {
      completedSentenceIndices.value.add(i)
    }
    // Immediately play sentence audio on entering practice
    playCurrentSentenceTTS(true)
  } else {
    practiceStore.showToast('该课时暂无题目数据')
  }
}

// Watch lessonId route parameter to continuously load new lessons
watch(
  () => route.params.lessonId,
  async (newId) => {
    if (newId) {
      await loadCurrentLesson(newId as string)
    }
  }
)

function handleBeforeUnload() {
  syncStudySeconds(true)
}

// Initialize practice
onMounted(async () => {
  fetchUserFavoriteSentences()
  if (lessonId.value) {
    await loadCurrentLesson(lessonId.value)
  }
  if (userStore.isFreeQuotaExhausted) {
    practiceStore.stopTimer()
    showQuotaExhaustedModal.value = true
  } else {
    startStudyHeartbeat()
  }
  window.addEventListener('keydown', handleGlobalKeydown)
  window.addEventListener('keydown', recordUserActivity)
  window.addEventListener('mousedown', recordUserActivity)
  window.addEventListener('touchstart', recordUserActivity)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  window.addEventListener('beforeunload', handleBeforeUnload)
})

onUnmounted(() => {
  stopStudyHeartbeat()
  syncStudySeconds(true)
  practiceStore.stopTimer()
  ttsService.stop()
  if (countdownTimer) clearInterval(countdownTimer)
  if (sentenceTtsTimer) clearTimeout(sentenceTtsTimer)
  window.removeEventListener('keydown', handleGlobalKeydown)
  window.removeEventListener('keydown', recordUserActivity)
  window.removeEventListener('mousedown', recordUserActivity)
  window.removeEventListener('touchstart', recordUserActivity)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  window.removeEventListener('beforeunload', handleBeforeUnload)
})

onBeforeRouteLeave(async () => {
  syncStudySeconds(true)
})

// Watch sentence change to auto read and reset word inputs
watch(
  () => practiceStore.currentSentenceIndex,
  (newIdx, oldIdx) => {
    initWordInputs()
    saveCurrentProgress()
    if (settingsStore.settings.sound.switchQuestion.enabled) {
      soundService.playSwitchSound(settingsStore.settings.sound.switchQuestion.volume / 100)
    }
    if (newIdx !== oldIdx && settingsStore.settings.pronunciation.autoReadOnSwitch) {
      playCurrentSentenceTTS(false)
    }
  }
)

function playSentenceTTS() {
  if (!currentSentence.value) return
  if (typeof window !== 'undefined' && window.speechSynthesis && window.speechSynthesis.paused) {
    try {
      window.speechSynthesis.resume()
    } catch {}
  }
  ttsService.speak({
    text: currentSentence.value.sentenceEn,
    words: currentSentence.value.words,
    speed: settingsStore.settings.pronunciation?.speed ?? 1.0,
    volume: (settingsStore.settings.pronunciation?.volume ?? 100) / 100,
    voice: settingsStore.settings.pronunciation?.voice ?? 'en-US-JennyNeural',
  })
}

function handleExit() {
  practiceStore.showConfirmExitModal = true
}

async function confirmExit() {
  practiceStore.showConfirmExitModal = false
  syncStudySeconds(true)
  practiceStore.showToast('已为您记录个人练习进度')
  router.push(`/course/${courseId.value}`)
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {})
  } else {
    document.exitFullscreen().catch(() => {})
  }
}

function resetProgress() {
  practiceStore.currentSentenceIndex = 0
  practiceStore.resetSentenceState()
  completedSentenceIndices.value.clear()
  initWordInputs()
  saveCurrentProgress()
  practiceStore.showToast('练习进度已归零')
}

function switchMode(m: PracticeMode) {
  practiceStore.setMode(m)
  showModeDropdown.value = false
  practiceStore.showToast(`已切换至：${getModeLabel(m)}`)
}

function getModeLabel(m: PracticeMode) {
  switch (m) {
    case 'typing':
      return '打字练习'
    case 'puzzle':
      return '拼图模式'
    case 'dictation':
      return '听写模式'
    case 'translation':
      return '中译英模式'
  }
}

// ----------------- Cross-Word Continuous Input with Case-Insensitive & Space-Free -----------------
function handleInputChar(char: string) {
  if (practiceStore.isAnswerCorrect || !currentSentence.value) return

  const words = sentenceWordList.value
  if (!words.length) return

  // 1. Space key handling: "不用考虑空格"
  // User does NOT need to hit space; if they do, advance to next word without penalty
  if (char === ' ') {
    if (activeWordIndex.value < words.length - 1) {
      activeWordIndex.value += 1
    }
    return
  }

  if (activeWordIndex.value >= words.length) {
    activeWordIndex.value = words.length - 1
  }

  const curWord = words[activeWordIndex.value]
  const currentTyped = wordInputs.value[activeWordIndex.value] || ''

  if (settingsStore.settings.sound.typing.enabled) {
    soundService.playTypingSound(settingsStore.settings.sound.typing.volume / 100)
  }

  // Next expected character in current active word
  const nextExpected = curWord.raw[currentTyped.length]

  // Branch A: Direct case-insensitive match
  if (nextExpected && char.toLowerCase() === nextExpected.toLowerCase()) {
    wordInputs.value[activeWordIndex.value] = currentTyped + nextExpected
    advanceWordIfCompleted()
    checkCompletion()
    return
  }

  // Branch B: Next expected is an apostrophe (e.g. What's) and user typed the letter after it
  if (nextExpected === "'" && curWord.raw[currentTyped.length + 1]) {
    const charAfter = curWord.raw[currentTyped.length + 1]
    if (char.toLowerCase() === charAfter.toLowerCase()) {
      wordInputs.value[activeWordIndex.value] = currentTyped + "'" + charAfter
      advanceWordIfCompleted()
      checkCompletion()
      return
    }
  }

  // Branch C: Clean word letters are complete, but trailing punctuation remains (e.g. "morning!")
  // If user continues typing and typed the first letter of the NEXT word:
  if (
    currentTyped.toLowerCase() === curWord.cleanWord.toLowerCase() &&
    curWord.trailingPunct &&
    activeWordIndex.value < words.length - 1
  ) {
    const nextWord = words[activeWordIndex.value + 1]
    const nextWordExpected = nextWord.raw[0]
    if (nextWordExpected && char.toLowerCase() === nextWordExpected.toLowerCase()) {
      wordInputs.value[activeWordIndex.value] = curWord.raw
      activeWordIndex.value += 1
      wordInputs.value[activeWordIndex.value] = nextWordExpected
      advanceWordIfCompleted()
      checkCompletion()
      return
    }
  }

  // Branch D: Current word was already fully completed, but user types next letter
  // Continuous cross-word flow forwards it to the next word
  if (isWordCompleted(activeWordIndex.value) && activeWordIndex.value < words.length - 1) {
    activeWordIndex.value += 1
    const nextW = words[activeWordIndex.value]
    const nextTyped = wordInputs.value[activeWordIndex.value] || ''
    const nextExpected2 = nextW.raw[nextTyped.length]
    if (nextExpected2 && char.toLowerCase() === nextExpected2.toLowerCase()) {
      wordInputs.value[activeWordIndex.value] = nextTyped + nextExpected2
      advanceWordIfCompleted()
      checkCompletion()
      return
    }
  }

  // Branch E: Incorrect character
  triggerTypingError()
}

function advanceWordIfCompleted() {
  const words = sentenceWordList.value
  const curWord = words[activeWordIndex.value]
  if (!curWord) return

  let currentTyped = wordInputs.value[activeWordIndex.value] || ''

  // If clean word letters are filled and has trailing punctuation, auto-attach it
  if (
    currentTyped.length === curWord.cleanWord.length &&
    currentTyped.toLowerCase() === curWord.cleanWord.toLowerCase() &&
    curWord.trailingPunct
  ) {
    wordInputs.value[activeWordIndex.value] = curWord.raw
    currentTyped = curWord.raw
  }

  // If this word is fully matched, auto-advance to the next incomplete word
  if (currentTyped.toLowerCase() === curWord.raw.toLowerCase()) {
    const nextIncompleteIdx = words.findIndex((_, idx) => idx > activeWordIndex.value && !isWordCompleted(idx))
    if (nextIncompleteIdx !== -1) {
      activeWordIndex.value = nextIncompleteIdx
      if (practiceStore.isSplitMode && settingsStore.settings.sound.switchQuestion.enabled) {
        soundService.playSwitchSound(settingsStore.settings.sound.switchQuestion.volume / 200)
      }
    } else if (activeWordIndex.value < words.length - 1) {
      activeWordIndex.value += 1
    }
  }
}

function handleBackspace() {
  if (practiceStore.isAnswerCorrect) return

  const curTyped = wordInputs.value[activeWordIndex.value] || ''
  const curWord = sentenceWordList.value[activeWordIndex.value]

  if (curTyped.length > 0) {
    if (curWord && curTyped === curWord.raw && curWord.trailingPunct) {
      wordInputs.value[activeWordIndex.value] = curWord.cleanWord
    } else {
      wordInputs.value[activeWordIndex.value] = curTyped.slice(0, -1)
    }
  } else {
    // Current word is empty -> move focus to previous word
    if (activeWordIndex.value > 0) {
      activeWordIndex.value -= 1
    }
  }
}

function checkCompletion(isManualSubmit = false) {
  if (!currentSentence.value) return
  const allCompleted = sentenceWordList.value.length > 0 && sentenceWordList.value.every((_, i) => isWordCompleted(i))
  if (allCompleted) {
    practiceStore.userInput = currentSentence.value.sentenceEn
    onAnswerSuccess()
  } else if (isManualSubmit) {
    triggerTypingError()
  }
}

function handleSubmit() {
  if (practiceStore.isAnswerCorrect) {
    handleNextOrFinish()
  } else {
    checkCompletion(true)
  }
}

function triggerTypingError() {
  practiceStore.errorCount += 1
  practiceStore.triggerShake()
  if (settingsStore.settings.sound.answerError.enabled) {
    soundService.playErrorSound(settingsStore.settings.sound.answerError.volume / 100)
  }
  // DO NOT reveal answer immediately on error; only shake the input interface
  // 自动将错误记录加入复习本（错题记录）
  if (currentSentence.value) {
    reviewStore.addError(
      currentSentence.value.sentenceEn,
      currentSentence.value.sentenceCn,
      currentSentence.value.words.map((w) => w.phonetic).join(' '),
      currentSentence.value.words,
      courseStore.getCourseById(courseId.value)?.title || '研习岛课程'
    )
  }
}

function handleAddToUnfamiliar() {
  if (currentSentence.value) {
    reviewStore.addUnfamiliar(
      currentSentence.value.sentenceEn,
      currentSentence.value.sentenceCn,
      currentSentence.value.words.map((w) => w.phonetic).join(' '),
      currentSentence.value.words,
      courseStore.getCourseById(courseId.value)?.title || '研习岛课程'
    )
    practiceStore.showToast('已加入复习本（不熟悉）')
  }
}

function onAnswerSuccess() {
  practiceStore.isAnswerCorrect = true
  practiceStore.isAnswerRevealed = true
  sentenceWordList.value.forEach((w, i) => {
    wordInputs.value[i] = w.raw
  })
  userStore.recordSentenceCompleted()

  // 记录当前句子已完成
  completedSentenceIndices.value.add(practiceStore.currentSentenceIndex)

  // Correct Sound
  if (settingsStore.settings.sound.answerCorrect.enabled) {
    soundService.playCorrectSound(settingsStore.settings.sound.answerCorrect.volume / 100)
  }

  // Confetti
  if (settingsStore.settings.personalization.confettiEnabled) {
    confetti({
      particleCount: 60,
      spread: 70,
      origin: { y: 0.6 },
    })
  }

  // NOTE: Sentence is read only on initial display. Do not auto-read here; user triggers manually via key or click.

  const isLastSentence = practiceStore.currentSentenceIndex >= practiceStore.totalSentences - 1

  if (isLastSentence) {
    // 检查本课时所有句子是否均已完成
    if (completedSentenceIndices.value.size >= practiceStore.totalSentences) {
      setTimeout(() => {
        handleLessonCompleted()
      }, 1200)
    } else {
      const remaining = practiceStore.totalSentences - completedSentenceIndices.value.size
      practiceStore.showToast(`已完成当前句，但本课时尚有 ${remaining} 句未完成，整体练习不算完成！`)
    }
  } else {
    // Auto next if configured
    if (settingsStore.settings.answer.autoNextOnCorrect) {
      setTimeout(() => {
        if (pendingQuotaExhausted.value || userStore.isFreeQuotaExhausted) {
          practiceStore.stopTimer()
          showQuotaExhaustedModal.value = true
          return
        }
        practiceStore.nextSentence()
        saveCurrentProgress()
      }, 1500)
    }
  }
}

async function handleLessonCompleted() {
  syncStudySeconds(true)
  practiceStore.stopTimer()
  if (settingsStore.settings.sound.courseCompleted.enabled) {
    soundService.playCompletedSound(settingsStore.settings.sound.courseCompleted.volume / 100)
  }
  confetti({
    particleCount: 120,
    spread: 90,
    origin: { y: 0.5 },
  })

  await courseStore.completeLesson(lessonId.value, practiceStore.timerSeconds)
  showLessonCompletedModal.value = true

  if (nextLesson.value) {
    autoNextCountdown.value = 3
    if (countdownTimer) clearInterval(countdownTimer)
    countdownTimer = setInterval(() => {
      autoNextCountdown.value -= 1
      if (autoNextCountdown.value <= 0) {
        clearInterval(countdownTimer)
        if (showLessonCompletedModal.value) {
          proceedToNextLesson()
        }
      }
    }, 1000)
  }
}

function proceedToNextLesson() {
  if (countdownTimer) clearInterval(countdownTimer)
  showLessonCompletedModal.value = false
  if (nextLesson.value) {
    router.push(`/practice/${courseId.value}/${nextLesson.value.id}`)
  }
}

function replayLesson() {
  if (countdownTimer) clearInterval(countdownTimer)
  showLessonCompletedModal.value = false
  resetProgress()
}

function handleNextOrFinish() {
  // 必须完成当前句子的完整单词输入，未完成时禁止进入下一题或完成课时
  if (!isCurrentSentenceCompleted.value) {
    triggerTypingError()
    practiceStore.showToast('请先完成当前句子的单词输入！')
    return
  }

  // 记录当前句子已完成
  completedSentenceIndices.value.add(practiceStore.currentSentenceIndex)

  if (practiceStore.currentSentenceIndex >= practiceStore.totalSentences - 1) {
    // 校验整课所有句子是否均已完成
    const total = practiceStore.totalSentences
    const completedCount = completedSentenceIndices.value.size
    if (total > 0 && completedCount < total) {
      // 寻找首个未完成的句子索引并引导跳转
      let firstUnfinishedIdx = -1
      for (let i = 0; i < total; i++) {
        if (!completedSentenceIndices.value.has(i)) {
          firstUnfinishedIdx = i
          break
        }
      }
      if (firstUnfinishedIdx !== -1) {
        practiceStore.currentSentenceIndex = firstUnfinishedIdx
        initWordInputs()
        practiceStore.showToast(`本课时尚有未完成的句子（已完成 ${completedCount}/${total} 句），整体练习不算完成！`)
        return
      }
    }
    handleLessonCompleted()
  } else {
    if (pendingQuotaExhausted.value || userStore.isFreeQuotaExhausted) {
      practiceStore.stopTimer()
      showQuotaExhaustedModal.value = true
      return
    }
    practiceStore.nextSentence()
    saveCurrentProgress()
  }
}

// Puzzle mode logic
function addPuzzleWord(token: { id: string; word: string; isUsed: boolean }) {
  if (token.isUsed || practiceStore.isAnswerCorrect) return
  token.isUsed = true
  practiceStore.selectedPuzzleWords.push(token)
  verifyPuzzle()
}

function removePuzzleWord(index: number) {
  if (practiceStore.isAnswerCorrect) return
  const [removed] = practiceStore.selectedPuzzleWords.splice(index, 1)
  if (removed) {
    const original = practiceStore.puzzleTokens.find((t) => t.id === removed.id)
    if (original) original.isUsed = false
  }
}

function resetPuzzle() {
  practiceStore.selectedPuzzleWords.forEach((token) => {
    const original = practiceStore.puzzleTokens.find((t) => t.id === token.id)
    if (original) original.isUsed = false
  })
  practiceStore.selectedPuzzleWords = []
}

function verifyPuzzle() {
  if (!currentSentence.value) return
  const assembled = practiceStore.selectedPuzzleWords.map((t) => t.word).join(' ')
  const targetClean = currentSentence.value.sentenceEn.replace(/[?,.!]/g, '').trim()
  if (assembled.toLowerCase() === targetClean.toLowerCase()) {
    practiceStore.userInput = currentSentence.value.sentenceEn
    onAnswerSuccess()
  }
}

// Global Keyboard Handler
function handleGlobalKeydown(e: KeyboardEvent) {
  // Prevent default for specific shortcuts
  if (e.ctrlKey && (e.key.toLowerCase() === 'a' || e.key.toLowerCase() === 'q' || e.key === ';')) {
    e.preventDefault()
  }

  // Ctrl + A or F2: Read aloud manually
  if ((e.ctrlKey && e.key.toLowerCase() === 'a') || e.key === 'F2') {
    e.preventDefault()
    playSentenceTTS()
    return
  }

  // Ctrl + S: Toggle favorite current sentence
  if (e.ctrlKey && e.key.toLowerCase() === 's') {
    e.preventDefault()
    toggleFavoriteCurrentSentence()
    return
  }

  // Ctrl + Q: Add to unfamiliar review list
  if (e.ctrlKey && e.key.toLowerCase() === 'q') {
    handleAddToUnfamiliar()
    return
  }

  // Ctrl + ; : Try again
  if (e.ctrlKey && e.key === ';') {
    practiceStore.resetSentenceState()
    initWordInputs()
    practiceStore.showToast('再来一次')
    return
  }

  // Shift + ArrowLeft/Right: Prev/Next
  if (e.shiftKey && e.key === 'ArrowLeft') {
    e.preventDefault()
    practiceStore.prevSentence()
    return
  }
  if (e.shiftKey && e.key === 'ArrowRight') {
    e.preventDefault()
    handleNextOrFinish()
    return
  }

  // ArrowUp / ArrowDown: Toggle answer
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault()
    practiceStore.isAnswerRevealed = !practiceStore.isAnswerRevealed
    return
  }

  // Backspace
  if (e.key === 'Backspace') {
    handleBackspace()
    return
  }

  // Enter: Submit / Proceed to next or finish (Space submission is removed)
  if (e.key === 'Enter') {
    e.preventDefault()
    handleSubmit()
    return
  }

  // Regular single character
  if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
    if (practiceStore.mode === 'typing' || practiceStore.mode === 'dictation' || practiceStore.mode === 'translation') {
      handleInputChar(e.key)
    }
  }
}
</script>

<template>
  <div class="h-screen w-screen flex flex-col bg-[var(--user-practice-bg,#0a0c13)] text-white select-none overflow-hidden relative">
    <!-- Top Toolbar (SRS 2.4.2) -->
    <header class="h-14 flex items-center justify-between px-6 border-b border-[#1e2336]/80 bg-[#0d101b] shrink-0 z-30">
      <!-- Left Return & Title Progress -->
      <div class="flex items-center gap-4">
        <button
          @click="handleExit"
          class="px-3 py-1.5 rounded-xl bg-[#1a2034] hover:bg-[#232b45] text-slate-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          <ArrowLeft class="w-3.5 h-3.5" />
          <span>返回</span>
        </button>

        <div class="text-xs font-medium text-slate-300 flex items-center gap-2">
          <span class="font-bold text-white">{{ currentLesson?.titleEn }} {{ currentLesson?.titleCn }}</span>
          <span class="text-indigo-400 font-mono">({{ practiceStore.currentSentenceIndex + 1 }}/{{ practiceStore.totalSentences }})</span>
          <button
            v-if="nextLesson"
            @click="proceedToNextLesson"
            class="px-2.5 py-1 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 text-indigo-300 text-[11px] font-semibold flex items-center gap-1 transition-colors cursor-pointer ml-2"
            title="快捷进入下一课时"
          >
            <span>下一课</span>
            <ArrowRight class="w-3 h-3" />
          </button>
        </div>
      </div>

      <!-- Right Control Icons -->
      <div class="flex items-center gap-2 text-xs">
        <!-- Settings -->
        <button
          @click="practiceStore.showSettingsModal = true"
          class="px-3 py-1.5 rounded-xl bg-[#161a2b] hover:bg-[#202740] border border-[#252c46] text-slate-300 flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          <Settings class="w-3.5 h-3.5" />
          <span>设置</span>
        </button>

        <!-- Mode Switch Dropdown -->
        <div class="relative">
          <button
            @click="showModeDropdown = !showModeDropdown"
            class="px-3 py-1.5 rounded-xl bg-[#161a2b] hover:bg-[#202740] border border-[#252c46] text-slate-300 flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <span>{{ getModeLabel(practiceStore.mode) }}</span>
            <ChevronDown class="w-3.5 h-3.5" />
          </button>

          <!-- Dropdown menu -->
          <div
            v-if="showModeDropdown"
            class="absolute right-0 top-full mt-1.5 w-36 py-1.5 rounded-xl bg-[#181c2d] border border-[#29324e] shadow-2xl z-50 flex flex-col"
          >
            <button
              @click="switchMode('translation')"
              :class="['px-4 py-2 text-xs text-left flex items-center justify-between', practiceStore.mode === 'translation' ? 'text-indigo-400 font-bold' : 'text-slate-300 hover:bg-[#222840]']"
            >
              <span>中译英模式</span>
              <Check v-if="practiceStore.mode === 'translation'" class="w-3.5 h-3.5" />
            </button>
            <button
              @click="switchMode('dictation')"
              :class="['px-4 py-2 text-xs text-left flex items-center justify-between', practiceStore.mode === 'dictation' ? 'text-indigo-400 font-bold' : 'text-slate-300 hover:bg-[#222840]']"
            >
              <span>听写模式</span>
              <Check v-if="practiceStore.mode === 'dictation'" class="w-3.5 h-3.5" />
            </button>
            <button
              @click="switchMode('typing')"
              :class="['px-4 py-2 text-xs text-left flex items-center justify-between', practiceStore.mode === 'typing' ? 'text-indigo-400 font-bold' : 'text-slate-300 hover:bg-[#222840]']"
            >
              <span>打字练习</span>
              <Check v-if="practiceStore.mode === 'typing'" class="w-3.5 h-3.5" />
            </button>
            <button
              @click="switchMode('puzzle')"
              :class="['px-4 py-2 text-xs text-left flex items-center justify-between', practiceStore.mode === 'puzzle' ? 'text-indigo-400 font-bold' : 'text-slate-300 hover:bg-[#222840]']"
            >
              <span>拼图模式</span>
              <Check v-if="practiceStore.mode === 'puzzle'" class="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <!-- Contents list -->
        <button
          @click="practiceStore.showContentsDrawer = true"
          class="px-3 py-1.5 rounded-xl bg-[#161a2b] hover:bg-[#202740] border border-[#252c46] text-slate-300 flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          <BookOpen class="w-3.5 h-3.5" />
          <span>学习内容</span>
        </button>

        <!-- Reset progress -->
        <button
          @click="resetProgress"
          class="px-3 py-1.5 rounded-xl bg-[#161a2b] hover:bg-[#202740] border border-[#252c46] text-slate-300 flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          <RotateCcw class="w-3.5 h-3.5" />
          <span>重置进度</span>
        </button>

        <!-- Personalization -->
        <button
          @click="practiceStore.showPersonalizationModal = true"
          class="px-3 py-1.5 rounded-xl bg-[#161a2b] hover:bg-[#202740] border border-[#252c46] text-slate-300 flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          <Palette class="w-3.5 h-3.5" />
          <span>个性化</span>
        </button>

        <!-- Report Issue -->
        <button
          @click="practiceStore.showReportModal = true"
          class="px-3 py-1.5 rounded-xl bg-[#161a2b] hover:bg-[#202740] border border-[#252c46] text-slate-300 flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          <AlertCircle class="w-3.5 h-3.5" />
          <span>报错</span>
        </button>

        <!-- Fullscreen -->
        <button
          @click="toggleFullscreen"
          class="p-1.5 rounded-xl bg-[#161a2b] hover:bg-[#202740] border border-[#252c46] text-slate-300 transition-colors cursor-pointer"
          title="全屏切换"
        >
          <Maximize2 class="w-3.5 h-3.5" />
        </button>
      </div>
    </header>

    <!-- Sub Toolbar: Timer & Split / Image toggles (SRS 2.4.3) -->
    <div class="h-12 flex items-center justify-between px-6 border-b border-[#181c2c]/60 bg-[#0a0c14] shrink-0 text-xs">
      <div class="flex items-center gap-4">
        <!-- Timer -->
        <div class="flex items-center gap-1.5 text-slate-400 font-mono">
          <Clock class="w-3.5 h-3.5" />
          <span>{{ formattedTimer }}</span>
        </div>

        <!-- Split / Whole toggle -->
        <div class="flex items-center bg-[#151928] rounded-lg p-0.5 border border-[#22283e]">
          <button
            @click="toggleSplitMode(true)"
            :class="['px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer', practiceStore.isSplitMode ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-400 hover:text-slate-200']"
          >
            拆句练习
          </button>
          <button
            @click="toggleSplitMode(false)"
            :class="['px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer', !practiceStore.isSplitMode ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-400 hover:text-slate-200']"
          >
            整句练习
          </button>
        </div>

        <!-- Show Image switch -->
        <label class="flex items-center gap-2 cursor-pointer text-slate-400 hover:text-slate-200">
          <input type="checkbox" v-model="practiceStore.showImage" class="accent-indigo-600 w-4 h-4 rounded" />
          <span>显示图片</span>
        </label>
      </div>

      <!-- Favorite Sentence button -->
      <button
        @click="toggleFavoriteCurrentSentence"
        :class="[
          'flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs transition-colors cursor-pointer border',
          isCurrentSentenceFavorited
            ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
            : 'bg-[#181d2f] hover:bg-[#23293f] text-slate-300 hover:text-white border-transparent'
        ]"
        :title="isCurrentSentenceFavorited ? '点击取消收藏此句' : '点击收藏此句 (Ctrl+S)'"
      >
        <Star class="w-3.5 h-3.5" :class="isCurrentSentenceFavorited ? 'text-amber-400 fill-amber-400' : 'text-slate-400'" />
        <span>{{ isCurrentSentenceFavorited ? '已收藏' : '收藏 (Ctrl+S)' }}</span>
      </button>

      <!-- Quick TTS Speaker trigger -->
      <button
        @click="playSentenceTTS"
        class="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#181d2f] hover:bg-indigo-600 text-slate-300 hover:text-white transition-colors cursor-pointer"
      >
        <Volume2 class="w-3.5 h-3.5" />
        <span>发音 (Ctrl+A)</span>
      </button>
    </div>

    <!-- Main Practice Center Stage -->
    <main class="flex-1 flex flex-col items-center justify-center p-6 overflow-y-auto relative">
      <div v-if="currentSentence" class="w-full max-w-3xl flex flex-col items-center text-center space-y-6">
        <!-- Question Image (smooth fade) -->
        <div
          v-if="practiceStore.showImage && currentSentence.imageUrl"
          class="w-56 h-36 rounded-2xl overflow-hidden shadow-2xl border border-[#262c44] bg-slate-800 shrink-0"
        >
          <img :src="currentSentence.imageUrl" alt="Question" class="w-full h-full object-cover" />
        </div>

        <!-- Chinese Translation (Hidden in dictation mode) -->
        <div
          v-if="practiceStore.mode !== 'dictation'"
          class="text-base font-semibold text-slate-300 tracking-wide flex items-center justify-center gap-2"
        >
          <span>{{ currentSentence.sentenceCn }}</span>
          <button
            @click="playSentenceTTS"
            class="p-1.5 rounded-lg text-slate-400 hover:text-indigo-400 hover:bg-[#1e243b] transition-colors cursor-pointer inline-flex items-center gap-1 text-xs"
            title="点击朗读整句 (快捷键: Ctrl+A 或 F2)"
          >
            <Volume2 class="w-4 h-4" />
            <span class="text-[11px] text-slate-500 font-mono hidden sm:inline">Ctrl+A</span>
          </button>
          <button
            @click="toggleFavoriteCurrentSentence"
            class="p-1.5 rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1 text-xs"
            :class="isCurrentSentenceFavorited ? 'text-amber-400 bg-amber-500/10' : 'text-slate-400 hover:text-amber-400 hover:bg-[#1e243b]'"
            :title="isCurrentSentenceFavorited ? '已收藏此句（点击取消）' : '收藏此句 (Ctrl+S)'"
          >
            <Star class="w-4 h-4" :class="isCurrentSentenceFavorited ? 'fill-amber-400 text-amber-400' : ''" />
            <span class="text-[11px] font-mono hidden sm:inline" :class="isCurrentSentenceFavorited ? 'text-amber-400 font-semibold' : 'text-slate-500'">Ctrl+S</span>
          </button>
        </div>
        <div
          v-else
          class="flex items-center justify-center gap-2"
        >
          <button
            @click="playSentenceTTS"
            class="px-3 py-1.5 rounded-lg bg-[#1a1f33] text-indigo-300 hover:text-white hover:bg-indigo-600 transition-colors cursor-pointer inline-flex items-center gap-2 text-sm shadow-md"
            title="点击朗读整句 (快捷键: Ctrl+A 或 F2)"
          >
            <Volume2 class="w-4 h-4" />
            <span>听句子 (Ctrl+A / F2)</span>
          </button>
          <button
            @click="toggleFavoriteCurrentSentence"
            class="p-2 rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1 text-xs bg-[#1a1f33] hover:bg-[#252c46]"
            :class="isCurrentSentenceFavorited ? 'text-amber-400' : 'text-slate-400 hover:text-amber-400'"
            :title="isCurrentSentenceFavorited ? '已收藏此句（点击取消）' : '收藏此句 (Ctrl+S)'"
          >
            <Star class="w-4 h-4" :class="isCurrentSentenceFavorited ? 'fill-amber-400 text-amber-400' : ''" />
          </button>
        </div>

        <!-- ANSWER REVEALED / COMPLETE VIEW (Phonetics & POS tags matching 3-4.png) -->
        <div v-if="practiceStore.isAnswerRevealed" class="flex flex-col items-center gap-4 animate-fade-in">
          <div class="flex flex-wrap items-center justify-center gap-3">
            <div
              v-for="word in currentSentence.words"
              :key="word.index"
              class="flex flex-col items-center gap-1.5"
            >
              <!-- Phonetic -->
              <span class="text-xs text-slate-400 font-mono">/{{ word.phonetic }}/</span>
              <!-- Tag Pill -->
              <span v-if="word.posTag" class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                {{ word.posTag }}
              </span>
              <!-- Word box -->
              <div class="px-4 py-2 rounded-xl bg-white text-slate-900 font-bold text-xl shadow-lg">
                {{ word.word }}
              </div>
              <!-- Sub Tag -->
              <span v-if="word.posTag" class="px-2 py-0.5 rounded text-[10px] bg-[#1a1f33] text-slate-400">
                {{ word.posTag }}
              </span>
            </div>
          </div>
          <!-- Manual Re-read button when revealed -->
          <button
            @click="playSentenceTTS"
            class="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#1a1f33] hover:bg-[#232942] border border-[#2b3352] text-slate-300 hover:text-white text-xs font-medium cursor-pointer transition-colors"
            title="重新朗读整句 (快捷键: Ctrl+A 或 F2)"
          >
            <Volume2 class="w-3.5 h-3.5 text-indigo-400" />
            <span>朗读整句 (Ctrl+A / F2)</span>
          </button>
        </div>

        <!-- PRACTICE INPUT DISPLAY (When not revealed) -->
        <div v-else class="w-full">
          <!-- 1. TYPING / DICTATION / TRANSLATION INPUT DISPLAY -->
          <!-- 1. TYPING / DICTATION / TRANSLATION INPUT DISPLAY -->
          <div v-if="practiceStore.mode !== 'puzzle'" class="w-full">
            <!-- A: 拆句练习模式 (把一句里面每个单词抽出来，单独来进行输入，完成一个单词就进行该句子的下一个单词，直到整句完成) -->
            <div
              v-if="practiceStore.isSplitMode"
              class="w-full flex flex-col items-center space-y-4 animate-fade-in"
            >
              <!-- 句子单词流进度导航条 -->
              <div class="w-full max-w-2xl flex flex-col items-center gap-2">
                <div class="flex items-center justify-between w-full px-2 text-xs text-slate-400">
                  <span class="flex items-center gap-1.5 font-medium text-indigo-300">
                    <span class="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span>
                    <span>拆句练习：逐词单独输入</span>
                  </span>
                  <span class="font-mono bg-[#161a2b] px-2.5 py-0.5 rounded-full border border-[#252c46] text-slate-300">
                    第 <strong class="text-indigo-400 font-bold">{{ activeWordIndex + 1 }}</strong> / {{ sentenceWordList.length }} 词
                  </span>
                </div>

                <!-- 单词进度卡片胶囊条 -->
                <div class="split-progress-bar flex items-center justify-center gap-2 flex-wrap p-2.5 rounded-2xl bg-[#0e1220]/90 border border-[#21273d] w-full">
                  <div
                    v-for="(w, idx) in sentenceWordList"
                    :key="w.index"
                    @click="selectWord(idx)"
                    :class="[
                      'px-3 py-1 rounded-xl text-xs font-mono font-medium transition-all duration-200 cursor-pointer flex items-center gap-1 select-none',
                      activeWordIndex === idx
                        ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30 scale-105 border border-indigo-400'
                        : isWordCompleted(idx)
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30'
                          : 'bg-[#161a2b] text-slate-400 border border-[#252c46] hover:border-slate-500 hover:text-slate-200'
                    ]"
                    :title="'点击切换至单词：' + w.cleanWord"
                  >
                    <span>{{ practiceStore.mode === 'dictation' && !isWordCompleted(idx) ? '•••' : w.raw }}</span>
                    <span v-if="isWordCompleted(idx)" class="text-emerald-400 font-bold text-[10px]">✓</span>
                  </div>
                </div>
              </div>

              <!-- 抽出的单个单词核心聚焦卡片 -->
              <div
                :class="[
                  'split-core-card relative flex flex-col items-center justify-center p-6 md:p-8 rounded-3xl border select-none w-full max-w-xl mx-auto shadow-2xl transition-all duration-200',
                  practiceStore.isShaking ? 'animate-shake' : '',
                  'bg-[#121629]/95 border-indigo-500/40 shadow-indigo-500/10'
                ]"
              >
                <!-- 卡片顶部导航：上一词 / 序号 / 下一词 -->
                <div class="flex items-center justify-between w-full mb-3 text-xs">
                  <button
                    @click="selectWord(activeWordIndex - 1)"
                    :disabled="activeWordIndex === 0"
                    :class="[
                      'flex items-center gap-1 px-3 py-1 rounded-lg border transition-colors',
                      activeWordIndex === 0
                        ? 'border-transparent text-slate-600 opacity-40 cursor-not-allowed'
                        : 'border-[#272e48] bg-[#181d30] text-slate-300 hover:text-white hover:border-indigo-500 cursor-pointer'
                    ]"
                  >
                    <ChevronLeft class="w-3.5 h-3.5" /> 上一词
                  </button>

                  <span class="text-xs text-indigo-300/80 font-mono">
                    Word {{ activeWordIndex + 1 }} of {{ sentenceWordList.length }}
                  </span>

                  <button
                    @click="selectWord(activeWordIndex + 1)"
                    :disabled="activeWordIndex >= sentenceWordList.length - 1"
                    :class="[
                      'flex items-center gap-1 px-3 py-1 rounded-lg border transition-colors',
                      activeWordIndex >= sentenceWordList.length - 1
                        ? 'border-transparent text-slate-600 opacity-40 cursor-not-allowed'
                        : 'border-[#272e48] bg-[#181d30] text-slate-300 hover:text-white hover:border-indigo-500 cursor-pointer'
                    ]"
                  >
                    下一词 <ChevronRight class="w-3.5 h-3.5" />
                  </button>
                </div>

                <!-- 单词音标与发音按钮 -->
                <div class="flex items-center gap-2 mb-2">
                  <span
                    v-if="currentSplitWord?.phonetic"
                    class="text-sm md:text-base font-mono text-indigo-300 bg-indigo-950/50 px-3 py-1 rounded-full border border-indigo-800/50"
                  >
                    /{{ currentSplitWord.phonetic }}/
                  </span>
                  <button
                    v-if="currentSplitWord"
                    @click="playWordTTS(currentSplitWord)"
                    class="p-1.5 rounded-xl bg-[#1a2035] hover:bg-indigo-600 text-slate-300 hover:text-white transition-colors cursor-pointer border border-[#2b3554]"
                    title="朗读当前单词"
                  >
                    <Volume2 class="w-4 h-4" />
                  </button>
                </div>

                <!-- 核心大号输入槽位 -->
                <div class="flex items-center justify-center min-w-[14rem] py-4 px-8 rounded-2xl bg-[#090b14] border-2 border-[#222942] shadow-inner text-3xl md:text-4xl font-bold font-mono tracking-widest my-3">
                  <template v-for="(char, cIdx) in (currentSplitWord?.raw || '')" :key="cIdx">
                    <!-- 已输入字符 -->
                    <span
                      v-if="cIdx < (wordInputs[activeWordIndex]?.length || 0)"
                      class="text-[var(--user-input-color,#38bdf8)] drop-shadow"
                    >
                      {{ wordInputs[activeWordIndex][cIdx] }}
                    </span>

                    <!-- 闪烁光标 -->
                    <span
                      v-else-if="cIdx === (wordInputs[activeWordIndex]?.length || 0) && !practiceStore.isAnswerCorrect"
                      class="text-indigo-400 animate-pulse font-light"
                    >
                      |
                    </span>

                    <!-- 未输入占位槽 -->
                    <span
                      v-else
                      class="text-slate-600 font-normal"
                    >
                      {{ isPunctuation(char) ? char : '_' }}
                    </span>
                  </template>
                </div>

                <!-- 单词进度指示条 -->
                <div class="w-48 h-1 rounded-full bg-slate-800 overflow-hidden my-1">
                  <div
                    class="h-full transition-all duration-200"
                    :class="isWordCompleted(activeWordIndex) ? 'bg-emerald-400 w-full' : 'bg-indigo-500'"
                    :style="{ width: isWordCompleted(activeWordIndex) ? '100%' : `${Math.min(100, ((wordInputs[activeWordIndex]?.length || 0) / (currentSplitWord?.raw.length || 1)) * 100)}%` }"
                  ></div>
                </div>

                <!-- 单词中文释义或提示 -->
                <div class="mt-3 text-center">
                  <p v-if="currentSplitWord?.meaning" class="text-sm font-semibold text-slate-200">
                    {{ currentSplitWord.meaning }}
                  </p>
                  <p v-else class="text-xs text-slate-400">
                    完成当前单词后将自动进入下一词
                  </p>
                </div>
              </div>
            </div>

            <!-- B: 整句练习模式 (整句所有单词卡片平铺) -->
            <div
              v-else
              :class="[
                'flex flex-wrap items-center justify-center gap-3.5 py-4 text-2xl font-bold font-mono tracking-wider',
                practiceStore.isShaking ? 'animate-shake' : ''
              ]"
            >
              <div
                v-for="(w, wIdx) in sentenceWordList"
                :key="w.index"
                @click="selectWord(wIdx)"
                :class="[
                  'sentence-word-card relative flex flex-col items-center p-2.5 px-3 rounded-2xl transition-all duration-200 cursor-pointer border select-none group',
                  activeWordIndex === wIdx
                    ? 'is-active bg-indigo-950/50 border-indigo-500 shadow-lg shadow-indigo-500/25 scale-[1.04]'
                    : isWordCompleted(wIdx)
                      ? 'is-completed bg-[#121624]/80 border-emerald-500/40 hover:border-emerald-400/60'
                      : 'is-pending bg-[#121624]/60 border-[#23293e] hover:border-slate-500 hover:bg-[#181d2f]/70'
                ]"
                :title="'点击单选此单词进行修改输入：' + w.cleanWord"
              >
                <!-- Phonetic Hint Header -->
                <div
                  v-if="w.phonetic"
                  class="text-[11px] font-normal font-mono mb-1 transition-colors"
                  :class="activeWordIndex === wIdx ? 'text-indigo-300' : 'text-slate-500 group-hover:text-slate-400'"
                >
                  /{{ w.phonetic }}/
                </div>

                <!-- Word Letters & Caret -->
                <div class="flex items-center min-w-[2.5rem] justify-center px-1">
                  <template v-for="(char, cIdx) in w.raw" :key="cIdx">
                    <!-- Typed character -->
                    <span
                      v-if="cIdx < (wordInputs[wIdx]?.length || 0)"
                      class="text-[var(--user-input-color,#38bdf8)] drop-shadow"
                    >
                      {{ wordInputs[wIdx][cIdx] }}
                    </span>

                    <!-- Blinking cursor caret at current input position inside active word -->
                    <span
                      v-else-if="cIdx === (wordInputs[wIdx]?.length || 0) && activeWordIndex === wIdx && !practiceStore.isAnswerCorrect"
                      class="text-indigo-400 animate-pulse font-light"
                    >
                      |
                    </span>

                    <!-- Untyped character slot -->
                    <span
                      v-else
                      class="text-slate-600 font-normal"
                    >
                      {{ isPunctuation(char) ? char : '_' }}
                    </span>
                  </template>
                </div>

                <!-- Underline Status Indicator -->
                <div
                  :class="[
                    'w-full h-1 rounded-full mt-2 transition-all duration-200',
                    activeWordIndex === wIdx
                      ? 'bg-indigo-500 shadow-sm shadow-indigo-400'
                      : isWordCompleted(wIdx)
                        ? 'bg-emerald-400/70'
                        : 'bg-slate-700'
                  ]"
                ></div>

                <!-- Meaning Label (if available) -->
                <div
                  v-if="w.meaning"
                  class="text-[10px] font-sans font-normal text-slate-400 mt-1 max-w-[6.5rem] truncate text-center"
                  :title="w.meaning"
                >
                  {{ w.meaning }}
                </div>
              </div>
            </div>
          </div>

          <!-- 2. PUZZLE MODE (3-2-3-4.png) -->
          <div v-else class="w-full max-w-lg mx-auto space-y-6">
            <!-- Target sentence assembly drop box -->
            <div class="p-6 rounded-2xl bg-[#121624] border border-[#272f48] min-h-[5rem] flex items-center justify-center flex-wrap gap-2 relative">
              <span v-if="practiceStore.selectedPuzzleWords.length === 0" class="text-xs text-slate-500">
                点击下方单词按钮组成句子
              </span>
              <button
                v-for="(token, sIdx) in practiceStore.selectedPuzzleWords"
                :key="token.id"
                @click="removePuzzleWord(sIdx)"
                class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-rose-600 text-white font-bold text-sm shadow-md transition-colors cursor-pointer"
              >
                {{ token.word }}
              </button>
              <div class="absolute right-3 top-3 flex items-center gap-1 text-slate-400">
                <button @click="resetPuzzle" class="p-1 hover:text-white" title="重置">
                  <RefreshCw class="w-3.5 h-3.5" />
                </button>
                <button @click="resetPuzzle" class="p-1 hover:text-white" title="清空">
                  <X class="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <!-- Scrambled word buttons -->
            <div class="flex flex-wrap items-center justify-center gap-3">
              <button
                v-for="token in practiceStore.puzzleTokens"
                :key="token.id"
                @click="addPuzzleWord(token)"
                :disabled="token.isUsed"
                :class="[
                  'px-6 py-3 rounded-2xl font-bold text-base border transition-all cursor-pointer shadow-lg',
                  token.isUsed
                    ? 'bg-[#151928] border-transparent text-slate-600 opacity-40 cursor-not-allowed'
                    : 'bg-[#1c2237] border-[#2c3654] text-white hover:bg-[#252c48] hover:border-indigo-500'
                ]"
              >
                {{ token.word }}
              </button>
            </div>
          </div>
        </div>

        <!-- Virtual Keyboard with Hand Guide (Visible in Typing mode) -->
        <div v-if="practiceStore.mode === 'typing' && !practiceStore.isAnswerRevealed" class="w-full">
          <VirtualKeyboard
            :next-char="currentNextChar"
            :active-finger="currentActiveFinger"
            @key-click="handleInputChar"
          />
        </div>
      </div>
    </main>

    <!-- Bottom Shortcut Keys Bar (SRS 2.4.4) -->
    <footer class="h-14 px-6 border-t border-[#1e2336]/80 bg-[#0d101b] flex items-center justify-center shrink-0 z-30">
      <div class="flex items-center gap-2 text-xs overflow-x-auto">
        <button
          @click="practiceStore.prevSentence"
          class="px-3 py-1.5 rounded-lg bg-[#161a2b] hover:bg-[#202740] border border-[#252c46] text-slate-300 font-medium flex items-center gap-1 cursor-pointer"
        >
          <span>&lt; 上一题</span>
        </button>

        <span class="px-2.5 py-1.5 rounded-lg bg-[#161a2b] border border-[#252c46] text-slate-400 font-medium">
          空格/←→ 跳格
        </span>

        <button
          @click="playSentenceTTS"
          class="px-2.5 py-1.5 rounded-lg bg-[#161a2b] hover:bg-[#202740] border border-[#252c46] text-slate-300 font-medium cursor-pointer"
          title="朗读整句 (快捷键: Ctrl+A 或 F2)"
        >
          Ctrl A/F2 朗读
        </button>

        <button
          @click="handleAddToUnfamiliar"
          class="px-2.5 py-1.5 rounded-lg bg-[#161a2b] hover:bg-[#202740] border border-[#252c46] text-slate-300 font-medium cursor-pointer"
          title="将当前题目加入复习本（快捷键: Ctrl+Q）"
        >
          Ctrl Q 不熟悉
        </button>

        <button
          @click="handleSubmit"
          class="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold cursor-pointer"
          title="提交完成本题 (快捷键: Enter)"
        >
          Enter 提交
        </button>

        <button
          @click="practiceStore.isAnswerRevealed = !practiceStore.isAnswerRevealed"
          class="px-2.5 py-1.5 rounded-lg bg-[#161a2b] hover:bg-[#202740] border border-[#252c46] text-slate-300 font-medium cursor-pointer"
        >
          ↓↑ 答案
        </button>

        <span class="px-2.5 py-1.5 rounded-lg bg-[#161a2b] border border-[#252c46] text-slate-400 font-medium">
          Shift ←→ 切题
        </span>

        <button
          @click="practiceStore.resetSentenceState()"
          class="px-2.5 py-1.5 rounded-lg bg-[#161a2b] hover:bg-[#202740] border border-[#252c46] text-slate-300 font-medium cursor-pointer"
        >
          Ctrl ; 再来一次
        </button>

        <button
          @click="handleNextOrFinish"
          :class="[
            'px-3 py-1.5 rounded-lg border font-semibold flex items-center gap-1.5 transition-all cursor-pointer',
            isCurrentSentenceCompleted
              ? 'bg-indigo-600 hover:bg-indigo-500 border-indigo-500/50 text-white shadow-md shadow-indigo-600/30'
              : 'bg-slate-800 hover:bg-slate-700/80 border-slate-700 text-slate-400 hover:text-slate-200'
          ]"
          :title="isCurrentSentenceCompleted ? '进入下一题或完成课时' : '请先完成当前句子的单词输入'"
        >
          <span>{{ practiceStore.currentSentenceIndex >= practiceStore.totalSentences - 1 ? '完成课时 ✓' : '下一题 >' }}</span>
          <span v-if="!isCurrentSentenceCompleted" class="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/80 text-amber-300 font-normal">待完成</span>
        </button>
      </div>
    </footer>

    <!-- Toast Notification Overlay -->
    <div
      v-if="practiceStore.toastMessage"
      class="fixed top-8 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-xl bg-indigo-600/90 backdrop-blur-md text-white font-medium text-xs shadow-2xl border border-indigo-400/40 animate-fade-in"
    >
      {{ practiceStore.toastMessage }}
    </div>

    <!-- Modals -->
    <PracticeSettingsModal />
    <PersonalizationModal />
    <ContentsDrawer />
    <ReportModal />

    <!-- Lesson Completed Celebratory Modal (SRS Continuous Learning Flow) -->
    <div
      v-if="showLessonCompletedModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 select-none animate-fade-in"
    >
      <div class="w-full max-w-md bg-[#161b2b] border border-[#2c3554] rounded-2xl p-6 shadow-2xl space-y-5 text-center relative overflow-hidden">
        <!-- Confetti & Celebration Header -->
        <div class="w-16 h-16 mx-auto rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-3xl shadow-lg shadow-emerald-500/20">
          🎉
        </div>

        <div>
          <h3 class="text-lg font-bold text-white tracking-wide">恭喜通关本课时！</h3>
          <p class="text-xs text-slate-300 mt-1">{{ currentLesson?.titleEn }}</p>
          <p class="text-[11px] text-slate-400">{{ currentLesson?.titleCn }}</p>
        </div>

        <!-- Practice Stats Card -->
        <div class="grid grid-cols-3 gap-2 py-1">
          <div class="p-3 rounded-xl bg-[#0f121d] border border-[#22283e]">
            <div class="text-[10px] text-slate-400">完成题目</div>
            <div class="text-base font-bold text-emerald-400 font-mono mt-0.5">
              {{ practiceStore.totalSentences }} 题
            </div>
          </div>
          <div class="p-3 rounded-xl bg-[#0f121d] border border-[#22283e]">
            <div class="text-[10px] text-slate-400">用时时长</div>
            <div class="text-base font-bold text-white font-mono mt-0.5">
              {{ formattedTimer }}
            </div>
          </div>
          <div class="p-3 rounded-xl bg-[#0f121d] border border-[#22283e]">
            <div class="text-[10px] text-slate-400">错误次数</div>
            <div class="text-base font-bold text-amber-400 font-mono mt-0.5">
              {{ practiceStore.errorCount }} 次
            </div>
          </div>
        </div>

        <!-- Continuous Learning Action Buttons -->
        <div class="space-y-2 pt-1">
          <button
            v-if="nextLesson"
            @click="proceedToNextLesson"
            class="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/30 cursor-pointer transition-all"
          >
            <span>连续练习：进入下一课时 ({{ nextLesson.titleEn }})</span>
            <span v-if="autoNextCountdown > 0" class="text-[10px] opacity-80 font-mono">({{ autoNextCountdown }}s)</span>
          </button>

          <div class="flex items-center gap-2">
            <button
              @click="replayLesson"
              class="flex-1 py-2 rounded-xl bg-[#20273f] hover:bg-[#2a3454] text-xs font-semibold text-slate-300 hover:text-white cursor-pointer transition-colors"
            >
              再练一次本课
            </button>
            <button
              @click="router.push(`/course/${courseId}`)"
              class="flex-1 py-2 rounded-xl bg-[#171b2a] hover:bg-[#20263c] text-xs font-semibold text-slate-400 hover:text-white cursor-pointer transition-colors border border-[#252c42]"
            >
              返回课程大纲
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Quota Exhausted Modal (Soft-Landing Daily Achievement Card) -->
    <div
      v-if="showQuotaExhaustedModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
    >
      <div class="w-full max-w-md bg-[#181c2b] border border-amber-500/30 rounded-2xl p-6 shadow-2xl text-center space-y-4">
        <div class="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-amber-500/20 to-indigo-500/20 border border-amber-500/30 flex items-center justify-center text-2xl">
          🏆
        </div>
        <div>
          <h3 class="text-lg font-bold text-white">今日免费研习时长已用完</h3>
          <p class="text-xs text-slate-400 mt-1">
            今日已完成 {{ Math.floor((userStore.profile?.todayUsedSeconds || 0) / 60) }} 分钟专注练习，收获
            <span class="text-amber-400 font-bold">+{{ userStore.profile?.todayExp || 0 }} EXP</span>！
          </p>
        </div>

        <div class="p-3.5 rounded-xl bg-[#0f121d] border border-[#252c44] text-left space-y-2">
          <div class="flex items-center justify-between text-xs">
            <span class="text-slate-400">当前等级</span>
            <span class="font-bold text-indigo-400">Lv.{{ userStore.levelInfo.level }} · {{ userStore.levelInfo.title }}</span>
          </div>
          <div class="flex items-center justify-between text-xs">
            <span class="text-slate-400">每日免费额度</span>
            <span class="font-mono text-white">{{ userStore.levelInfo.dailyQuotaMinutes }} 分钟 / 天</span>
          </div>
          <div v-if="userStore.levelInfo.level < 30" class="flex items-center justify-between text-xs">
            <span class="text-slate-400">下一级 (Lv.{{ userStore.levelInfo.level + 1 }})</span>
            <span class="text-emerald-400 font-medium">每日解锁 {{ userStore.levelInfo.dailyQuotaMinutes + 3 }} 分钟 (+3分钟)</span>
          </div>
          <div class="pt-1 border-t border-[#1e2336] text-[11px] text-amber-300/90">
            ✨ 升级 VIP 会员可享无限时长练习与 1.25x 经验加成（请联系管理员开通）。
          </div>
        </div>

        <div class="flex items-center gap-2.5 pt-1">
          <button
            @click="router.push('/courses')"
            class="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white cursor-pointer transition-colors"
          >
            返回课程广场
          </button>
          <button
            @click="router.push('/')"
            class="flex-1 py-2.5 rounded-xl bg-[#252b41] hover:bg-[#303754] text-xs font-semibold text-slate-300 cursor-pointer transition-colors"
          >
            回到首页
          </button>
        </div>
      </div>
    </div>

    <!-- Confirm Exit Modal -->
    <div
      v-if="practiceStore.showConfirmExitModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
    >
      <div class="w-full max-w-sm bg-[#181c2b] border border-[#272d45] rounded-2xl p-6 shadow-2xl text-center space-y-4">
        <h3 class="text-base font-bold text-white">退出将丢失当前进度，确定退出吗？</h3>
        <p class="text-xs text-slate-400">当前小节练习进度将保留已完成记录。</p>
        <div class="flex items-center gap-3 pt-2">
          <button
            @click="practiceStore.showConfirmExitModal = false"
            class="modal-btn-cancel flex-1 py-2 rounded-xl bg-[#252b41] hover:bg-[#303754] text-xs font-semibold text-slate-300"
          >
            取消
          </button>
          <button
            @click="confirmExit"
            class="flex-1 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white"
          >
            确定退出
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
