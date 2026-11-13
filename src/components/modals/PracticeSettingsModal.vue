<script setup lang="ts">
import { ref } from 'vue'
import { useSettingsStore } from '../../stores/settingsStore'
import { usePracticeStore } from '../../stores/practiceStore'
import { ttsService } from '../../services/ttsService'
import { soundService } from '../../services/soundService'
import { X, Volume2, RotateCcw } from 'lucide-vue-next'
import CustomSelect from '../common/CustomSelect.vue'

const voiceOptions = [
  { label: '美式超拟人女声 (Ava) - 推荐', value: 'en-US-AvaNeural' },
  { label: '美式超拟人男声 (Andrew) - 推荐', value: 'en-US-AndrewNeural' },
  { label: '美式经典女声 (Jenny) - 播音级', value: 'en-US-JennyNeural' },
  { label: '美式沉稳男声 (Guy) - 浑厚温和', value: 'en-US-GuyNeural' },
  { label: '美式知性女声 (Emma) - 清透自然', value: 'en-US-EmmaNeural' },
  { label: '美式商务男声 (Christopher) - 端庄稳重', value: 'en-US-ChristopherNeural' },
  { label: '英式优雅女声 (Sonia) - 标准英音', value: 'en-GB-SoniaNeural' },
  { label: '英式绅士男声 (Ryan) - 磁性英伦', value: 'en-GB-RyanNeural' },
  { label: '英式现代女声 (Libby) - 自然流畅', value: 'en-GB-LibbyNeural' },
  { label: '灵动可爱童声 (Ana) - 活泼纯真', value: 'en-US-AnaNeural' },
]

const errorThresholdOptions = [
  { label: '错误1次后', value: 1 },
  { label: '错误2次后', value: 2 },
  { label: '错误3次后', value: 3 },
  { label: '错误5次后', value: 5 },
  { label: '永不显示', value: -1 },
]

const settingsStore = useSettingsStore()
const practiceStore = usePracticeStore()

const activeTab = ref<'voice' | 'sound' | 'answer' | 'keys'>('sound')

function auditionTTS() {
  ttsService.speak({
    text: 'Hello, welcome to Yanxi Island.',
    speed: settingsStore.settings.pronunciation?.speed ?? 1.0,
    volume: (settingsStore.settings.pronunciation?.volume ?? 100) / 100,
    voice: settingsStore.settings.pronunciation?.voice ?? 'en-US-JennyNeural',
  })
}

function onVoiceChange() {
  settingsStore.save()
  auditionTTS()
}

function auditionSound(type: 'typing' | 'switch' | 'correct' | 'error' | 'completed') {
  switch (type) {
    case 'typing':
      soundService.playTypingSound(settingsStore.settings.sound.typing.volume / 100)
      break
    case 'switch':
      soundService.playSwitchSound(settingsStore.settings.sound.switchQuestion.volume / 100)
      break
    case 'correct':
      soundService.playCorrectSound(settingsStore.settings.sound.answerCorrect.volume / 100)
      break
    case 'error':
      soundService.playErrorSound(settingsStore.settings.sound.answerError.volume / 100)
      break
    case 'completed':
      soundService.playCompletedSound(settingsStore.settings.sound.courseCompleted.volume / 100)
      break
  }
}

function handleReset() {
  settingsStore.resetToDefault()
  practiceStore.showToast('已恢复默认设置')
}
</script>

<template>
  <div
    v-if="practiceStore.showSettingsModal"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 select-none"
    @click.self="practiceStore.showSettingsModal = false"
  >
    <div class="w-full max-w-xl bg-[#181c2b] border border-[#272d45] rounded-2xl shadow-2xl overflow-hidden flex flex-col">
      <!-- Header -->
      <div class="flex items-center justify-between px-6 pt-5 pb-3 border-b border-[#242b41]">
        <div class="flex items-center gap-5">
          <span class="text-base font-bold text-white mr-2">设置</span>
          <button
            @click="activeTab = 'voice'"
            :class="['text-xs font-semibold pb-1 relative transition-colors', activeTab === 'voice' ? 'text-indigo-400 after:absolute after:bottom-0 after:inset-x-0 after:h-0.5 after:bg-indigo-500' : 'text-slate-400 hover:text-slate-200']"
          >
            发音
          </button>
          <button
            @click="activeTab = 'sound'"
            :class="['text-xs font-semibold pb-1 relative transition-colors', activeTab === 'sound' ? 'text-indigo-400 after:absolute after:bottom-0 after:inset-x-0 after:h-0.5 after:bg-indigo-500' : 'text-slate-400 hover:text-slate-200']"
          >
            音效
          </button>
          <button
            @click="activeTab = 'answer'"
            :class="['text-xs font-semibold pb-1 relative transition-colors', activeTab === 'answer' ? 'text-indigo-400 after:absolute after:bottom-0 after:inset-x-0 after:h-0.5 after:bg-indigo-500' : 'text-slate-400 hover:text-slate-200']"
          >
            答题
          </button>
          <button
            @click="activeTab = 'keys'"
            :class="['text-xs font-semibold pb-1 relative transition-colors', activeTab === 'keys' ? 'text-indigo-400 after:absolute after:bottom-0 after:inset-x-0 after:h-0.5 after:bg-indigo-500' : 'text-slate-400 hover:text-slate-200']"
          >
            快捷键
          </button>
        </div>

        <div class="flex items-center gap-3">
          <button
            @click="handleReset"
            class="text-xs text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
          >
            <RotateCcw class="w-3.5 h-3.5" />
            <span>恢复默认</span>
          </button>
          <button
            @click="practiceStore.showSettingsModal = false"
            class="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-[#23293f] transition-colors"
          >
            <X class="w-5 h-5" />
          </button>
        </div>
      </div>

      <!-- Content -->
      <div class="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
        <!-- Tab 1: Pronunciation Settings (3-12.png) -->
        <div v-if="activeTab === 'voice'" class="space-y-3">
          <!-- Voice Switchers -->
          <div class="p-4 rounded-xl bg-[#141826] border border-[#22283e] flex items-center justify-between">
            <span class="text-xs font-medium text-slate-200">切题后自动朗读（继续练习，题目切换时自动朗读）</span>
            <input
              type="checkbox"
              v-model="settingsStore.settings.pronunciation.autoReadOnSwitch"
              @change="settingsStore.debouncedSave()"
              class="w-4 h-4 accent-indigo-600 rounded cursor-pointer"
            />
          </div>

          <div class="p-4 rounded-xl bg-[#141826] border border-[#22283e] flex items-center justify-between">
            <span class="text-xs font-medium text-slate-200">答题正确后朗读（答题成功后自动朗读）</span>
            <input
              type="checkbox"
              v-model="settingsStore.settings.pronunciation.autoReadOnCorrect"
              @change="settingsStore.debouncedSave()"
              class="w-4 h-4 accent-indigo-600 rounded cursor-pointer"
            />
          </div>

          <!-- Voice Timbre selection -->
          <div class="p-4 rounded-xl bg-[#141826] border border-[#22283e] flex items-center justify-between">
            <span class="text-xs font-medium text-slate-200">发音人音色（纯TTS实时合成）</span>
            <div class="flex items-center gap-2 min-w-[210px]">
              <CustomSelect
                v-model="settingsStore.settings.pronunciation.voice"
                :options="voiceOptions"
                size="sm"
                @change="onVoiceChange"
                class="w-48"
              />
              <button
                @click="auditionTTS"
                class="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs cursor-pointer flex items-center gap-1 font-medium transition-colors"
                title="试听发音"
              >
                <Volume2 class="w-3.5 h-3.5" />
                <span>试听</span>
              </button>
            </div>
          </div>

          <!-- Stepper: Repeat Count -->
          <div class="p-4 rounded-xl bg-[#141826] border border-[#22283e] flex items-center justify-between text-xs">
            <span class="text-slate-200 font-medium">朗读次数</span>
            <div class="flex items-center gap-3">
              <button
                @click="settingsStore.settings.pronunciation.repeatCount = Math.max(1, settingsStore.settings.pronunciation.repeatCount - 1); settingsStore.debouncedSave()"
                class="w-6 h-6 rounded bg-[#20273c] hover:bg-[#2b3450] text-white flex items-center justify-center font-bold cursor-pointer"
              >
                -
              </button>
              <span class="font-bold text-indigo-400 font-mono">{{ settingsStore.settings.pronunciation.repeatCount }} 次</span>
              <button
                @click="settingsStore.settings.pronunciation.repeatCount = Math.min(5, settingsStore.settings.pronunciation.repeatCount + 1); settingsStore.debouncedSave()"
                class="w-6 h-6 rounded bg-[#20273c] hover:bg-[#2b3450] text-white flex items-center justify-center font-bold cursor-pointer"
              >
                +
              </button>
            </div>
          </div>

          <!-- Stepper: Repeat Interval -->
          <div class="p-4 rounded-xl bg-[#141826] border border-[#22283e] flex items-center justify-between text-xs">
            <span class="text-slate-200 font-medium">朗读间隔</span>
            <div class="flex items-center gap-3">
              <button
                @click="settingsStore.settings.pronunciation.repeatIntervalSeconds = Math.max(0, settingsStore.settings.pronunciation.repeatIntervalSeconds - 1); settingsStore.debouncedSave()"
                class="w-6 h-6 rounded bg-[#20273c] hover:bg-[#2b3450] text-white flex items-center justify-center font-bold cursor-pointer"
              >
                -
              </button>
              <span class="font-bold text-indigo-400 font-mono">{{ settingsStore.settings.pronunciation.repeatIntervalSeconds }} 秒</span>
              <button
                @click="settingsStore.settings.pronunciation.repeatIntervalSeconds = Math.min(5, settingsStore.settings.pronunciation.repeatIntervalSeconds + 1); settingsStore.debouncedSave()"
                class="w-6 h-6 rounded bg-[#20273c] hover:bg-[#2b3450] text-white flex items-center justify-center font-bold cursor-pointer"
              >
                +
              </button>
            </div>
          </div>

          <!-- Slider: Speed -->
          <div class="p-4 rounded-xl bg-[#141826] border border-[#22283e] flex items-center justify-between text-xs">
            <span class="text-slate-200 font-medium">发音人语速</span>
            <div class="flex items-center gap-3">
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.1"
                v-model.number="settingsStore.settings.pronunciation.speed"
                @input="settingsStore.debouncedSave()"
                class="w-32 accent-indigo-500 cursor-pointer"
              />
              <span class="font-bold text-indigo-400 font-mono w-10 text-right">{{ settingsStore.settings.pronunciation.speed }}x</span>
            </div>
          </div>

          <!-- Slider: Volume -->
          <div class="p-4 rounded-xl bg-[#141826] border border-[#22283e] flex items-center justify-between text-xs">
            <span class="text-slate-200 font-medium">发音人音量</span>
            <div class="flex items-center gap-3">
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                v-model.number="settingsStore.settings.pronunciation.volume"
                @input="settingsStore.debouncedSave()"
                class="w-32 accent-indigo-500 cursor-pointer"
              />
              <span class="font-bold text-indigo-400 font-mono w-10 text-right">{{ settingsStore.settings.pronunciation.volume }}</span>
            </div>
          </div>
        </div>

        <!-- Tab 2: Sound Effects Settings (3-7.png) -->
        <div v-else-if="activeTab === 'sound'" class="space-y-3">
          <!-- Item 1: 打字音效 -->
          <div class="p-4 rounded-xl bg-[#141826] border border-[#22283e] flex items-center justify-between">
            <span class="text-xs font-medium text-slate-200">打字音效</span>
            <div class="flex items-center gap-3">
              <input type="checkbox" v-model="settingsStore.settings.sound.typing.enabled" class="w-4 h-4 accent-indigo-600 rounded" />
              <select class="px-2 py-1 rounded bg-[#1e2438] text-xs text-slate-300 border border-[#2a324d]">
                <option>默认</option>
                <option>青轴机械</option>
              </select>
              <input type="range" min="0" max="100" v-model.number="settingsStore.settings.sound.typing.volume" class="w-20 accent-indigo-500" />
              <span class="text-xs font-mono text-slate-400 w-6">{{ settingsStore.settings.sound.typing.volume }}</span>
              <button @click="auditionSound('typing')" class="p-1.5 rounded hover:bg-[#20273c] text-indigo-400">
                <Volume2 class="w-4 h-4" />
              </button>
            </div>
          </div>

          <!-- Item 2: 手动切题音效 -->
          <div class="p-4 rounded-xl bg-[#141826] border border-[#22283e] flex items-center justify-between">
            <span class="text-xs font-medium text-slate-200">手动切题音效</span>
            <div class="flex items-center gap-3">
              <input type="checkbox" v-model="settingsStore.settings.sound.switchQuestion.enabled" class="w-4 h-4 accent-indigo-600 rounded" />
              <select class="px-2 py-1 rounded bg-[#1e2438] text-xs text-slate-300 border border-[#2a324d]">
                <option>默认</option>
              </select>
              <input type="range" min="0" max="100" v-model.number="settingsStore.settings.sound.switchQuestion.volume" class="w-20 accent-indigo-500" />
              <span class="text-xs font-mono text-slate-400 w-6">{{ settingsStore.settings.sound.switchQuestion.volume }}</span>
              <button @click="auditionSound('switch')" class="p-1.5 rounded hover:bg-[#20273c] text-indigo-400">
                <Volume2 class="w-4 h-4" />
              </button>
            </div>
          </div>

          <!-- Item 3: 答题正确音效 -->
          <div class="p-4 rounded-xl bg-[#141826] border border-[#22283e] flex items-center justify-between">
            <span class="text-xs font-medium text-slate-200">答题正确音效</span>
            <div class="flex items-center gap-3">
              <input type="checkbox" v-model="settingsStore.settings.sound.answerCorrect.enabled" class="w-4 h-4 accent-indigo-600 rounded" />
              <select class="px-2 py-1 rounded bg-[#1e2438] text-xs text-slate-300 border border-[#2a324d]">
                <option>默认</option>
              </select>
              <input type="range" min="0" max="100" v-model.number="settingsStore.settings.sound.answerCorrect.volume" class="w-20 accent-indigo-500" />
              <span class="text-xs font-mono text-slate-400 w-6">{{ settingsStore.settings.sound.answerCorrect.volume }}</span>
              <button @click="auditionSound('correct')" class="p-1.5 rounded hover:bg-[#20273c] text-indigo-400">
                <Volume2 class="w-4 h-4" />
              </button>
            </div>
          </div>

          <!-- Item 4: 答题错误音效 -->
          <div class="p-4 rounded-xl bg-[#141826] border border-[#22283e] flex items-center justify-between">
            <span class="text-xs font-medium text-slate-200">答题错误音效</span>
            <div class="flex items-center gap-3">
              <input type="checkbox" v-model="settingsStore.settings.sound.answerError.enabled" class="w-4 h-4 accent-indigo-600 rounded" />
              <select class="px-2 py-1 rounded bg-[#1e2438] text-xs text-slate-300 border border-[#2a324d]">
                <option>默认</option>
              </select>
              <input type="range" min="0" max="100" v-model.number="settingsStore.settings.sound.answerError.volume" class="w-20 accent-indigo-500" />
              <span class="text-xs font-mono text-slate-400 w-6">{{ settingsStore.settings.sound.answerError.volume }}</span>
              <button @click="auditionSound('error')" class="p-1.5 rounded hover:bg-[#20273c] text-indigo-400">
                <Volume2 class="w-4 h-4" />
              </button>
            </div>
          </div>

          <!-- Item 5: 课程完成音效 -->
          <div class="p-4 rounded-xl bg-[#141826] border border-[#22283e] flex items-center justify-between">
            <span class="text-xs font-medium text-slate-200">课程完成音效</span>
            <div class="flex items-center gap-3">
              <input type="checkbox" v-model="settingsStore.settings.sound.courseCompleted.enabled" class="w-4 h-4 accent-indigo-600 rounded" />
              <select class="px-2 py-1 rounded bg-[#1e2438] text-xs text-slate-300 border border-[#2a324d]">
                <option>默认</option>
              </select>
              <input type="range" min="0" max="100" v-model.number="settingsStore.settings.sound.courseCompleted.volume" class="w-20 accent-indigo-500" />
              <span class="text-xs font-mono text-slate-400 w-6">{{ settingsStore.settings.sound.courseCompleted.volume }}</span>
              <button @click="auditionSound('completed')" class="p-1.5 rounded hover:bg-[#20273c] text-indigo-400">
                <Volume2 class="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        <!-- Tab 3: Answering Settings (3-11.png) -->
        <div v-else-if="activeTab === 'answer'" class="space-y-3">
          <div class="p-4 rounded-xl bg-[#141826] border border-[#22283e] flex items-center justify-between">
            <span class="text-xs font-medium text-slate-200">答题正确后自动下一题</span>
            <input type="checkbox" v-model="settingsStore.settings.answer.autoNextOnCorrect" class="w-4 h-4 accent-indigo-600 rounded" />
          </div>

          <div class="p-4 rounded-xl bg-[#141826] border border-[#22283e] flex items-center justify-between">
            <span class="text-xs font-medium text-slate-200">正确自动跳格</span>
            <input type="checkbox" v-model="settingsStore.settings.answer.autoAdvanceGrid" class="w-4 h-4 accent-indigo-600 rounded" />
          </div>

          <div class="p-4 rounded-xl bg-[#141826] border border-[#22283e] flex items-center justify-between">
            <span class="text-xs font-medium text-slate-200">切换模式重头开始</span>
            <input type="checkbox" v-model="settingsStore.settings.answer.resetOnModeSwitch" class="w-4 h-4 accent-indigo-600 rounded" />
          </div>

          <div class="p-4 rounded-xl bg-[#141826] border border-[#22283e] flex items-center justify-between">
            <span class="text-xs font-medium text-slate-200">答案弹窗自动显示</span>
            <input type="checkbox" v-model="settingsStore.settings.answer.autoShowAnswerModal" class="w-4 h-4 accent-indigo-600 rounded" />
          </div>

          <div class="p-4 rounded-xl bg-[#141826] border border-[#22283e] flex items-center justify-between">
            <span class="text-xs font-medium text-slate-200">错误几次时显示答案</span>
            <div class="w-36">
              <CustomSelect
                v-model="settingsStore.settings.answer.errorThresholdForAnswer"
                :options="errorThresholdOptions"
                size="sm"
                @change="settingsStore.save()"
              />
            </div>
          </div>
        </div>

        <!-- Tab 4: Shortcuts Mapping Overview -->
        <div v-else class="space-y-2.5">
          <div class="grid grid-cols-2 gap-3 text-xs">
            <div class="p-3 rounded-xl bg-[#141826] border border-[#22283e] flex justify-between">
              <span class="text-slate-400">上一题</span>
              <kbd class="px-2 py-0.5 rounded bg-[#20273c] text-indigo-300 font-mono">&lt;</kbd>
            </div>
            <div class="p-3 rounded-xl bg-[#141826] border border-[#22283e] flex justify-between">
              <span class="text-slate-400">下一题</span>
              <kbd class="px-2 py-0.5 rounded bg-[#20273c] text-indigo-300 font-mono">&gt;</kbd>
            </div>
            <div class="p-3 rounded-xl bg-[#141826] border border-[#22283e] flex justify-between">
              <span class="text-slate-400">跳格</span>
              <kbd class="px-2 py-0.5 rounded bg-[#20273c] text-indigo-300 font-mono">空格 / ←→</kbd>
            </div>
            <div class="p-3 rounded-xl bg-[#141826] border border-[#22283e] flex justify-between">
              <span class="text-slate-400">朗读 (TTS)</span>
              <kbd class="px-2 py-0.5 rounded bg-[#20273c] text-indigo-300 font-mono">Ctrl + A</kbd>
            </div>
            <div class="p-3 rounded-xl bg-[#141826] border border-[#22283e] flex justify-between">
              <span class="text-slate-400">不熟悉 (加入复习本)</span>
              <kbd class="px-2 py-0.5 rounded bg-[#20273c] text-indigo-300 font-mono">Ctrl + Q</kbd>
            </div>
            <div class="p-3 rounded-xl bg-[#141826] border border-[#22283e] flex justify-between">
              <span class="text-slate-400">提交</span>
              <kbd class="px-2 py-0.5 rounded bg-[#20273c] text-indigo-300 font-mono">Enter / 空格</kbd>
            </div>
            <div class="p-3 rounded-xl bg-[#141826] border border-[#22283e] flex justify-between">
              <span class="text-slate-400">显示/隐藏答案</span>
              <kbd class="px-2 py-0.5 rounded bg-[#20273c] text-indigo-300 font-mono">↓↑</kbd>
            </div>
            <div class="p-3 rounded-xl bg-[#141826] border border-[#22283e] flex justify-between">
              <span class="text-slate-400">再来一次</span>
              <kbd class="px-2 py-0.5 rounded bg-[#20273c] text-indigo-300 font-mono">Ctrl + ;</kbd>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
