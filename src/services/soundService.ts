class SoundService {
  private audioCtx: AudioContext | null = null

  private getContext(): AudioContext | null {
    if (!this.audioCtx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (AudioCtx) {
        this.audioCtx = new AudioCtx()
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume()
    }
    return this.audioCtx
  }

  private getSafeVolume(volume: any, fallback = 0.5): number {
    const v = Number(volume)
    if (isNaN(v) || !isFinite(v)) return fallback
    return Math.max(0, Math.min(1.0, v))
  }

  // Typewriter / keypress mechanical click
  public playTypingSound(volume = 0.5) {
    const ctx = this.getContext()
    if (!ctx) return
    const safeVol = this.getSafeVolume(volume, 0.5)

    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = 'triangle'
    osc.frequency.setValueAtTime(600 + Math.random() * 200, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.04)

    gain.gain.setValueAtTime(safeVol * 0.15, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04)

    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.start()
    osc.stop(ctx.currentTime + 0.05)
  }

  // Switch question whoosh / soft tick
  public playSwitchSound(volume = 0.5) {
    const ctx = this.getContext()
    if (!ctx) return
    const safeVol = this.getSafeVolume(volume, 0.5)

    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = 'sine'
    osc.frequency.setValueAtTime(320, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(540, ctx.currentTime + 0.08)

    gain.gain.setValueAtTime(safeVol * 0.2, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08)

    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.start()
    osc.stop(ctx.currentTime + 0.09)
  }

  // Answer correct pleasant chime (two harmonious tones)
  public playCorrectSound(volume = 0.6) {
    const ctx = this.getContext()
    if (!ctx) return
    const safeVol = this.getSafeVolume(volume, 0.6)

    const notes = [523.25, 659.25, 783.99] // C5, E5, G5 major triad
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.08)

      gain.gain.setValueAtTime(0, ctx.currentTime)
      gain.gain.setValueAtTime(safeVol * 0.25, ctx.currentTime + idx * 0.08)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.08 + 0.3)

      osc.connect(gain)
      gain.connect(ctx.destination)

      osc.start(ctx.currentTime + idx * 0.08)
      osc.stop(ctx.currentTime + idx * 0.08 + 0.35)
    })
  }

  // Answer error buzz
  public playErrorSound(volume = 0.6) {
    const ctx = this.getContext()
    if (!ctx) return
    const safeVol = this.getSafeVolume(volume, 0.6)

    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(150, ctx.currentTime)
    osc.frequency.setValueAtTime(130, ctx.currentTime + 0.1)

    gain.gain.setValueAtTime(safeVol * 0.3, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25)

    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.start()
    osc.stop(ctx.currentTime + 0.28)
  }

  // Course completed fanfare
  public playCompletedSound(volume = 0.7) {
    const ctx = this.getContext()
    if (!ctx) return
    const safeVol = this.getSafeVolume(volume, 0.7)

    const melody = [523.25, 659.25, 783.99, 1046.5] // C5, E5, G5, C6
    melody.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.type = 'triangle'
      osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.12)

      const startTime = ctx.currentTime + i * 0.12
      gain.gain.setValueAtTime(0, startTime)
      gain.gain.linearRampToValueAtTime(safeVol * 0.3, startTime + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.45)

      osc.connect(gain)
      gain.connect(ctx.destination)

      osc.start(startTime)
      osc.stop(startTime + 0.5)
    })
  }
}

export const soundService = new SoundService()
