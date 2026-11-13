<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  nextChar: string
  activeFinger: string | null
}>()

const emit = defineEmits<{
  (e: 'keyClick', char: string): void
}>()

// Standard QWERTY layout rows
const row1 = ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=']
const row2 = ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']', '\\']
const row3 = ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'"]
const row4 = ['Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/']

const targetCharUpper = computed(() => {
  if (!props.nextChar) return ''
  return props.nextChar.toUpperCase()
})

function isKeyActive(key: string) {
  if (!props.nextChar) return false
  if (key === 'Space' && props.nextChar === ' ') return true
  return key.toUpperCase() === targetCharUpper.value
}
</script>

<template>
  <div class="relative w-full max-w-2xl mx-auto select-none mt-2">
    <!-- Virtual Keyboard Glass Container -->
    <div class="p-4 rounded-3xl bg-[#121522]/90 border border-[#262e47]/80 backdrop-blur-md shadow-2xl relative z-10">
      <!-- Row 1 -->
      <div class="flex justify-center gap-1.5 mb-1.5">
        <button
          v-for="k in row1"
          :key="k"
          @click="emit('keyClick', k)"
          :class="[
            'w-10 h-10 rounded-xl text-xs font-semibold flex items-center justify-center transition-all duration-150',
            isKeyActive(k)
              ? 'bg-indigo-600 text-white ring-2 ring-indigo-400 shadow-lg shadow-indigo-500/50 scale-105'
              : 'bg-[#1a1f33] text-slate-300 hover:bg-[#252c48]'
          ]"
        >
          {{ k }}
        </button>
      </div>

      <!-- Row 2 -->
      <div class="flex justify-center gap-1.5 mb-1.5">
        <button
          v-for="k in row2"
          :key="k"
          @click="emit('keyClick', k)"
          :class="[
            'w-10 h-10 rounded-xl text-xs font-semibold flex items-center justify-center transition-all duration-150',
            isKeyActive(k)
              ? 'bg-indigo-600 text-white ring-2 ring-indigo-400 shadow-lg shadow-indigo-500/50 scale-105'
              : 'bg-[#1a1f33] text-slate-300 hover:bg-[#252c48]'
          ]"
        >
          {{ k }}
        </button>
      </div>

      <!-- Row 3 -->
      <div class="flex justify-center gap-1.5 mb-1.5">
        <button
          v-for="k in row3"
          :key="k"
          @click="emit('keyClick', k)"
          :class="[
            'w-10 h-10 rounded-xl text-xs font-semibold flex items-center justify-center transition-all duration-150',
            isKeyActive(k)
              ? 'bg-indigo-600 text-white ring-2 ring-indigo-400 shadow-lg shadow-indigo-500/50 scale-105'
              : 'bg-[#1a1f33] text-slate-300 hover:bg-[#252c48]'
          ]"
        >
          {{ k }}
        </button>
      </div>

      <!-- Row 4 -->
      <div class="flex justify-center gap-1.5 mb-2">
        <button
          v-for="k in row4"
          :key="k"
          @click="emit('keyClick', k)"
          :class="[
            'w-10 h-10 rounded-xl text-xs font-semibold flex items-center justify-center transition-all duration-150',
            isKeyActive(k)
              ? 'bg-indigo-600 text-white ring-2 ring-indigo-400 shadow-lg shadow-indigo-500/50 scale-105'
              : 'bg-[#1a1f33] text-slate-300 hover:bg-[#252c48]'
          ]"
        >
          {{ k }}
        </button>
      </div>

      <!-- Row 5: Space -->
      <div class="flex justify-center">
        <button
          @click="emit('keyClick', ' ')"
          :class="[
            'w-64 h-9 rounded-xl text-xs font-semibold flex items-center justify-center transition-all duration-150 tracking-wider',
            isKeyActive('Space')
              ? 'bg-indigo-600 text-white ring-2 ring-indigo-400 shadow-lg shadow-indigo-500/50'
              : 'bg-[#1a1f33] text-slate-400 hover:bg-[#252c48]'
          ]"
        >
          Space
        </button>
      </div>
    </div>

    <!-- Hand Gestures Silhouette & Active Finger Guidance (Matching 3-2-1.png) -->
    <div class="absolute -bottom-10 inset-x-0 flex justify-between px-16 pointer-events-none opacity-40 z-20">
      <!-- Left Hand -->
      <div class="relative w-44 h-48 flex flex-col items-center">
        <svg viewBox="0 0 160 180" class="w-full h-full fill-slate-400/30 stroke-slate-500/50 stroke-1">
          <!-- Palm and Fingers silhouette -->
          <path d="M 50 180 C 40 140, 20 110, 15 80 C 12 60, 20 50, 26 55 C 32 60, 36 90, 42 75 C 44 50, 52 35, 60 40 C 66 45, 65 75, 72 65 C 75 40, 85 30, 93 35 C 99 40, 96 75, 102 70 C 108 55, 120 50, 126 60 C 132 75, 120 110, 135 125 C 145 135, 130 160, 110 180 Z" />
          <!-- Finger glow highlight -->
          <circle
            v-if="props.activeFinger?.startsWith('left-')"
            cx="80" cy="55" r="14"
            class="fill-blue-500/60 stroke-blue-400 stroke-2 animate-pulse"
          />
        </svg>
      </div>

      <!-- Right Hand -->
      <div class="relative w-44 h-48 flex flex-col items-center">
        <svg viewBox="0 0 160 180" class="w-full h-full fill-slate-400/30 stroke-slate-500/50 stroke-1">
          <!-- Mirror palm and fingers -->
          <path d="M 110 180 C 120 140, 140 110, 145 80 C 148 60, 140 50, 134 55 C 128 60, 124 90, 118 75 C 116 50, 108 35, 100 40 C 94 45, 95 75, 88 65 C 85 40, 75 30, 67 35 C 61 40, 64 75, 58 70 C 52 55, 40 50, 34 60 C 28 75, 40 110, 25 125 C 15 135, 30 160, 50 180 Z" />
          <!-- Finger glow highlight -->
          <circle
            v-if="props.activeFinger?.startsWith('right-')"
            cx="80" cy="55" r="14"
            class="fill-blue-500/60 stroke-blue-400 stroke-2 animate-pulse"
          />
        </svg>
      </div>
    </div>
  </div>
</template>
