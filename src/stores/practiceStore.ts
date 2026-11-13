import { defineStore } from 'pinia'
import type { LessonItem, SentenceItem, PracticeMode } from '../types'

export type FingerType =
  | 'left-pinky'
  | 'left-ring'
  | 'left-middle'
  | 'left-index'
  | 'right-index'
  | 'right-middle'
  | 'right-ring'
  | 'right-pinky'
  | 'thumbs'

export const KEY_FINGER_MAP: Record<string, FingerType> = {
  // Left hand
  '1': 'left-pinky', 'q': 'left-pinky', 'a': 'left-pinky', 'z': 'left-pinky', '`': 'left-pinky',
  '2': 'left-ring', 'w': 'left-ring', 's': 'left-ring', 'x': 'left-ring',
  '3': 'left-middle', 'e': 'left-middle', 'd': 'left-middle', 'c': 'left-middle',
  '4': 'left-index', '5': 'left-index', 'r': 'left-index', 't': 'left-index', 'f': 'left-index', 'g': 'left-index', 'v': 'left-index', 'b': 'left-index',
  // Right hand
  '6': 'right-index', '7': 'right-index', 'y': 'right-index', 'u': 'right-index', 'h': 'right-index', 'j': 'right-index', 'n': 'right-index', 'm': 'right-index',
  '8': 'right-middle', 'i': 'right-middle', 'k': 'right-middle', ',': 'right-middle',
  '9': 'right-ring', 'o': 'right-ring', 'l': 'right-ring', '.': 'right-ring',
  '0': 'right-pinky', '-': 'right-pinky', '=': 'right-pinky', 'p': 'right-pinky', '[': 'right-pinky', ']': 'right-pinky', ';': 'right-pinky', "'": 'right-pinky', '/': 'right-pinky', '\\': 'right-pinky',
  ' ': 'thumbs',
}

export const usePracticeStore = defineStore('practice', {
  state: () => ({
    currentLesson: null as LessonItem | null,
    currentSentenceIndex: 0,
    mode: 'typing' as PracticeMode,
    isSplitMode: false,
    showImage: true,
    timerSeconds: 0, // Real accumulated course study duration in seconds
    timerInterval: null as number | null,

    // Typing interaction state
    userInput: '',
    errorCount: 0,
    isAnswerRevealed: false,
    isAnswerCorrect: false,
    isShaking: false,

    // Puzzle mode state
    puzzleTokens: [] as { id: string; word: string; isUsed: boolean }[],
    selectedPuzzleWords: [] as { id: string; word: string }[],

    // UI Drawers & Modals
    showContentsDrawer: false,
    showSettingsModal: false,
    showPersonalizationModal: false,
    showReportModal: false,
    showConfirmExitModal: false,
    toastMessage: '',
  }),

  getters: {
    currentSentence(state): SentenceItem | null {
      if (!state.currentLesson || !state.currentLesson.sentences.length) return null
      return state.currentLesson.sentences[state.currentSentenceIndex] || null
    },
    totalSentences(state): number {
      return state.currentLesson?.sentences.length || 0
    },
    targetText(): string {
      if (!this.currentSentence) return ''
      return this.currentSentence.sentenceEn
    },
    nextChar(): string {
      const target = this.targetText
      if (this.userInput.length >= target.length) return ''
      return target[this.userInput.length] || ''
    },
    activeFinger(): FingerType | null {
      const ch = this.nextChar.toLowerCase()
      if (!ch) return null
      return KEY_FINGER_MAP[ch] || null
    },
  },

  actions: {
    startPractice(lesson: LessonItem, initialIndex = 0, initialSeconds = 0) {
      this.currentLesson = lesson
      this.currentSentenceIndex = initialIndex
      if (initialSeconds !== undefined && initialSeconds !== null) {
        this.timerSeconds = initialSeconds
      }
      this.resetSentenceState()
      this.startTimer()
    },

    setTimerSeconds(seconds: number) {
      this.timerSeconds = Math.max(0, Math.floor(seconds || 0))
    },

    startTimer() {
      if (this.timerInterval) clearInterval(this.timerInterval)
      this.timerInterval = window.setInterval(() => {
        this.timerSeconds += 1
      }, 1000)
    },

    stopTimer() {
      if (this.timerInterval) {
        clearInterval(this.timerInterval)
        this.timerInterval = null
      }
    },

    resetSentenceState() {
      this.userInput = ''
      this.errorCount = 0
      this.isAnswerRevealed = false
      this.isAnswerCorrect = false
      this.isShaking = false

      // Init puzzle tokens if in puzzle mode
      if (this.currentSentence) {
        const words = this.currentSentence.sentenceEn
          .replace(/[?,.!]/g, '')
          .split(/\s+/)
          .filter(Boolean)
        // Shuffle
        const tokens = words.map((w, idx) => ({ id: `w_${idx}_${w}`, word: w, isUsed: false }))
        tokens.sort(() => Math.random() - 0.5)
        this.puzzleTokens = tokens
        this.selectedPuzzleWords = []
      }
    },

    setMode(newMode: PracticeMode) {
      this.mode = newMode
      this.resetSentenceState()
    },

    nextSentence() {
      if (!this.currentLesson) return
      if (this.currentSentenceIndex < this.currentLesson.sentences.length - 1) {
        this.currentSentenceIndex += 1
        this.resetSentenceState()
      }
    },

    prevSentence() {
      if (this.currentSentenceIndex > 0) {
        this.currentSentenceIndex -= 1
        this.resetSentenceState()
      }
    },

    jumpToSentence(index: number) {
      if (!this.currentLesson) return
      if (index >= 0 && index < this.currentLesson.sentences.length) {
        this.currentSentenceIndex = index
        this.resetSentenceState()
        this.showContentsDrawer = false
      }
    },

    showToast(msg: string) {
      this.toastMessage = msg
      setTimeout(() => {
        if (this.toastMessage === msg) {
          this.toastMessage = ''
        }
      }, 3000)
    },

    triggerShake() {
      this.isShaking = true
      setTimeout(() => {
        this.isShaking = false
      }, 350)
    },
  },
})
