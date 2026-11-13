<script setup lang="ts">
import { useSettingsStore } from '../../stores/settingsStore'
import { usePracticeStore } from '../../stores/practiceStore'
import confetti from 'canvas-confetti'
import { X, Play, RotateCcw } from 'lucide-vue-next'

const settingsStore = useSettingsStore()
const practiceStore = usePracticeStore()

const fontSizes: { label: string; value: 'min' | 'small' | 'default' | 'medium' | 'large' | 'max' }[] = [
  { label: '最小', value: 'min' },
  { label: '略小', value: 'small' },
  { label: '默认', value: 'default' },
  { label: '略大', value: 'medium' },
  { label: '偏大', value: 'large' },
  { label: '最大', value: 'max' },
]

function previewConfetti() {
  confetti({
    particleCount: 70,
    spread: 70,
    origin: { y: 0.6 },
  })
}

function handleReset() {
  settingsStore.settings.personalization = {
    inputTextColor: '#38bdf8',
    practiceTextColor: '#ffffff',
    practiceBgColor: '#0a0c13',
    cardBgColor: '#181c2b',
    confettiEnabled: true,
    fontSizeInput: 'default',
    fontSizeResult: 'default',
  }
  settingsStore.save()
  practiceStore.showToast('个性化已恢复默认')
}
</script>

<template>
  <div
    v-if="practiceStore.showPersonalizationModal"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 select-none"
    @click.self="practiceStore.showPersonalizationModal = false"
  >
    <div class="w-full max-w-xl bg-[#181c2b] border border-[#272d45] rounded-2xl shadow-2xl overflow-hidden flex flex-col">
      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-[#242b41]">
        <h3 class="text-base font-bold text-white">个性化</h3>
        <div class="flex items-center gap-3">
          <button
            @click="handleReset"
            class="text-xs text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
          >
            <RotateCcw class="w-3.5 h-3.5" />
            <span>恢复默认</span>
          </button>
          <button
            @click="practiceStore.showPersonalizationModal = false"
            class="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-[#23293f] transition-colors"
          >
            <X class="w-5 h-5" />
          </button>
        </div>
      </div>

      <!-- Settings List -->
      <div class="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
        <!-- Color 1: 输入答案字体颜色 -->
        <div class="flex items-center justify-between p-3.5 rounded-xl bg-[#141826] border border-[#22283e] text-xs">
          <span class="text-slate-200 font-medium">输入答案字体颜色</span>
          <div class="flex items-center gap-2">
            <input
              type="color"
              v-model="settingsStore.settings.personalization.inputTextColor"
              @change="settingsStore.save()"
              class="w-8 h-8 rounded-lg border-0 bg-transparent cursor-pointer"
            />
            <span class="text-slate-400 font-mono text-[11px]">{{ settingsStore.settings.personalization.inputTextColor }}</span>
          </div>
        </div>

        <!-- Color 2: 练习页面字体颜色 -->
        <div class="flex items-center justify-between p-3.5 rounded-xl bg-[#141826] border border-[#22283e] text-xs">
          <span class="text-slate-200 font-medium">练习页面字体颜色</span>
          <div class="flex items-center gap-2">
            <input
              type="color"
              v-model="settingsStore.settings.personalization.practiceTextColor"
              @change="settingsStore.save()"
              class="w-8 h-8 rounded-lg border-0 bg-transparent cursor-pointer"
            />
            <span class="text-slate-400 font-mono text-[11px]">{{ settingsStore.settings.personalization.practiceTextColor }}</span>
          </div>
        </div>

        <!-- Color 3: 练习页面背景颜色 -->
        <div class="flex items-center justify-between p-3.5 rounded-xl bg-[#141826] border border-[#22283e] text-xs">
          <span class="text-slate-200 font-medium">练习页面背景颜色</span>
          <div class="flex items-center gap-2">
            <input
              type="color"
              v-model="settingsStore.settings.personalization.practiceBgColor"
              @change="settingsStore.save()"
              class="w-8 h-8 rounded-lg border-0 bg-transparent cursor-pointer"
            />
            <span class="text-slate-400 font-mono text-[11px]">{{ settingsStore.settings.personalization.practiceBgColor }}</span>
          </div>
        </div>

        <!-- Color 4: 答案卡片背景颜色 -->
        <div class="flex items-center justify-between p-3.5 rounded-xl bg-[#141826] border border-[#22283e] text-xs">
          <span class="text-slate-200 font-medium">答案卡片背景颜色</span>
          <div class="flex items-center gap-2">
            <input
              type="color"
              v-model="settingsStore.settings.personalization.cardBgColor"
              @change="settingsStore.save()"
              class="w-8 h-8 rounded-lg border-0 bg-transparent cursor-pointer"
            />
            <span class="text-slate-400 font-mono text-[11px]">{{ settingsStore.settings.personalization.cardBgColor }}</span>
          </div>
        </div>

        <!-- Particle Effect: 答题正确特效 -->
        <div class="p-3.5 rounded-xl bg-[#141826] border border-[#22283e] flex items-center justify-between text-xs">
          <div>
            <div class="text-slate-200 font-medium">答题正确特效</div>
            <div class="text-[11px] text-slate-500">(如感觉卡顿，可关闭)</div>
          </div>
          <div class="flex items-center gap-3">
            <input
              type="checkbox"
              v-model="settingsStore.settings.personalization.confettiEnabled"
              @change="settingsStore.save()"
              class="w-4 h-4 accent-indigo-600 rounded cursor-pointer"
            />
            <select class="px-2 py-1 rounded bg-[#1e2438] text-xs text-slate-300 border border-[#2a324d]">
              <option>默认</option>
            </select>
            <button
              @click="previewConfetti"
              class="p-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer"
              title="预览特效"
            >
              <Play class="w-3.5 h-3.5 fill-white" />
            </button>
          </div>
        </div>

        <!-- Font Size: 输入区字体大小 -->
        <div class="p-4 rounded-xl bg-[#141826] border border-[#22283e] space-y-2">
          <div class="text-xs text-slate-200 font-medium">输入区字体大小</div>
          <div class="grid grid-cols-6 gap-2 pt-1">
            <button
              v-for="opt in fontSizes"
              :key="opt.value"
              @click="settingsStore.settings.personalization.fontSizeInput = opt.value; settingsStore.save()"
              :class="[
                'font-size-btn py-2 rounded-xl text-xs font-medium border flex flex-col items-center gap-1 transition-all cursor-pointer',
                settingsStore.settings.personalization.fontSizeInput === opt.value
                  ? 'is-active bg-indigo-600/20 border-indigo-500 text-indigo-300'
                  : 'is-inactive bg-[#1b2034] border-transparent text-slate-400 hover:text-slate-200'
              ]"
            >
              <div
                :class="[
                  'w-3 h-3 rounded-full border',
                  settingsStore.settings.personalization.fontSizeInput === opt.value
                    ? 'border-indigo-400 bg-indigo-500'
                    : 'border-slate-600'
                ]"
              ></div>
              <span>{{ opt.label }}</span>
            </button>
          </div>
        </div>

        <!-- Font Size: 结果字体大小 -->
        <div class="p-4 rounded-xl bg-[#141826] border border-[#22283e] space-y-2">
          <div class="text-xs text-slate-200 font-medium">结果字体大小</div>
          <div class="grid grid-cols-6 gap-2 pt-1">
            <button
              v-for="opt in fontSizes"
              :key="opt.value"
              @click="settingsStore.settings.personalization.fontSizeResult = opt.value; settingsStore.save()"
              :class="[
                'font-size-btn py-2 rounded-xl text-xs font-medium border flex flex-col items-center gap-1 transition-all cursor-pointer',
                settingsStore.settings.personalization.fontSizeResult === opt.value
                  ? 'is-active bg-indigo-600/20 border-indigo-500 text-indigo-300'
                  : 'is-inactive bg-[#1b2034] border-transparent text-slate-400 hover:text-slate-200'
              ]"
            >
              <div
                :class="[
                  'w-3 h-3 rounded-full border',
                  settingsStore.settings.personalization.fontSizeResult === opt.value
                    ? 'border-indigo-400 bg-indigo-500'
                    : 'border-slate-600'
                ]"
              ></div>
              <span>{{ opt.label }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
