<script setup lang="ts">
import { ref } from 'vue'
import { useMenuStore } from '../stores/menuStore'
import { useSettingsStore } from '../stores/settingsStore'
import { ttsService, VOICE_PROFILES } from '../services/ttsService'
import CustomSelect from '../components/common/CustomSelect.vue'

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
import {
  ArrowUp,
  ArrowDown,
  Edit2,
  Check,
  Volume2,
  Palette,
  LayoutList,
  RotateCcw,
  Sparkles,
  Sun,
  Moon,
} from 'lucide-vue-next'

const menuStore = useMenuStore()
const settingsStore = useSettingsStore()

const activeTab = ref<'menu' | 'general' | 'theme'>('menu')
const toastMsg = ref('')

const editingId = ref<string | null>(null)
const editLabelInput = ref('')

function startEditing(id: string, label: string) {
  editingId.value = id
  editLabelInput.value = label
}

function saveEditing(id: string) {
  if (editLabelInput.value.trim()) {
    menuStore.updateItem(id, { label: editLabelInput.value.trim() })
    editingId.value = null
    showToast('菜单重命名成功')
  }
}

function moveUp(idx: number) {
  menuStore.moveUp(idx)
  showToast('顺序已调整')
}

function moveDown(idx: number) {
  menuStore.moveDown(idx)
  showToast('顺序已调整')
}

function toggleEnable(id: string, val: boolean) {
  menuStore.updateItem(id, { isEnabled: val })
}

function showToast(msg: string) {
  toastMsg.value = msg
  setTimeout(() => {
    toastMsg.value = ''
  }, 2000)
}

function auditionTTS() {
  ttsService.speak({
    text: 'Hello, welcome to Yanxi Island. Practice makes perfect.',
    speed: settingsStore.settings.pronunciation?.speed ?? 1.0,
    volume: (settingsStore.settings.pronunciation?.volume ?? 100) / 100,
    voice: settingsStore.settings.pronunciation?.voice ?? 'en-US-JennyNeural',
  })
}

function onVoiceChange() {
  settingsStore.save()
  auditionTTS()
  const profileName = VOICE_PROFILES[settingsStore.settings.pronunciation.voice]?.name || '默认音色'
  showToast(`已切换发音人至：${profileName}`)
}

async function handleResetSettings() {
  await settingsStore.resetToDefault()
  showToast('已恢复发音与系统默认设置')
}
</script>

<template>
  <div class="p-8 space-y-6 max-w-5xl mx-auto select-none">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-bold text-white tracking-wide">平台设置</h1>
      <div v-if="toastMsg" class="px-4 py-1.5 rounded-xl bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 text-xs flex items-center gap-2 animate-fade-in">
        <Check class="w-3.5 h-3.5" />
        <span>{{ toastMsg }}</span>
      </div>
    </div>

    <!-- Tabs -->
    <div class="flex items-center gap-2 border-b border-[#22283e] pb-3">
      <button
        @click="activeTab = 'menu'"
        :class="[
          'px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer',
          activeTab === 'menu' ? 'bg-indigo-600 text-white' : 'bg-[#151928] text-slate-400 hover:text-white'
        ]"
      >
        <LayoutList class="w-4 h-4" />
        <span>左侧菜单栏配置</span>
      </button>
      <button
        @click="activeTab = 'general'"
        :class="[
          'px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer',
          activeTab === 'general' ? 'bg-indigo-600 text-white' : 'bg-[#151928] text-slate-400 hover:text-white'
        ]"
      >
        <Volume2 class="w-4 h-4" />
        <span>默认发音与音效</span>
      </button>
      <button
        @click="activeTab = 'theme'"
        :class="[
          'px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer',
          activeTab === 'theme' ? 'bg-indigo-600 text-white' : 'bg-[#151928] text-slate-400 hover:text-white'
        ]"
      >
        <Palette class="w-4 h-4" />
        <span>主题与深色模式</span>
      </button>
    </div>

    <!-- Tab 1: Menu Management (SRS 2.1.1) -->
    <div v-if="activeTab === 'menu'" class="space-y-4">
      <div class="text-xs text-slate-400">
        在此自定义侧边栏栏目的显示状态、名称与排序。（“首页”为系统核心模块，禁止隐藏）
      </div>

      <div class="space-y-2.5">
        <div
          v-for="(item, idx) in menuStore.menuItems"
          :key="item.id"
          class="p-4 rounded-2xl bg-[#141826] border border-[#22283e] flex items-center justify-between"
        >
          <!-- Left: Order & Label -->
          <div class="flex items-center gap-4">
            <span class="w-6 h-6 rounded-full bg-[#1e2438] flex items-center justify-center font-mono text-xs text-indigo-400 font-bold">
              {{ idx + 1 }}
            </span>

            <div v-if="editingId !== item.id" class="flex items-center gap-3">
              <span class="text-sm font-bold text-slate-200">{{ item.label }}</span>
              <button
                @click="startEditing(item.id, item.label)"
                class="p-1 rounded text-slate-500 hover:text-slate-200"
                title="重命名"
              >
                <Edit2 class="w-3.5 h-3.5" />
              </button>
            </div>
            <div v-else class="flex items-center gap-2">
              <input
                v-model="editLabelInput"
                type="text"
                class="px-2.5 py-1 rounded bg-[#1b2135] border border-indigo-500 text-white text-xs outline-none"
              />
              <button
                @click="saveEditing(item.id)"
                class="px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
              >
                保存
              </button>
              <button
                @click="editingId = null"
                class="px-2 py-1 rounded bg-slate-700 text-slate-300 text-xs"
              >
                取消
              </button>
            </div>
          </div>

          <!-- Right: Move & Enable toggle -->
          <div class="flex items-center gap-4 text-xs">
            <!-- Move Up / Down -->
            <div class="flex items-center gap-1">
              <button
                @click="moveUp(idx)"
                :disabled="idx === 0"
                :class="['p-1.5 rounded-lg border', idx === 0 ? 'border-transparent text-slate-600 cursor-not-allowed' : 'bg-[#1e2338] border-[#29324d] text-slate-300 hover:text-white cursor-pointer']"
                title="上移"
              >
                <ArrowUp class="w-3.5 h-3.5" />
              </button>
              <button
                @click="moveDown(idx)"
                :disabled="idx === menuStore.menuItems.length - 1"
                :class="['p-1.5 rounded-lg border', idx === menuStore.menuItems.length - 1 ? 'border-transparent text-slate-600 cursor-not-allowed' : 'bg-[#1e2338] border-[#29324d] text-slate-300 hover:text-white cursor-pointer']"
                title="下移"
              >
                <ArrowDown class="w-3.5 h-3.5" />
              </button>
            </div>

            <!-- Enable Switch -->
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                :checked="item.isEnabled"
                :disabled="item.id === 'home'"
                @change="toggleEnable(item.id, ($event.target as HTMLInputElement).checked)"
                class="w-4 h-4 accent-indigo-600 rounded disabled:opacity-40"
              />
              <span :class="item.isEnabled ? 'text-indigo-400 font-medium' : 'text-slate-500'">
                {{ item.id === 'home' ? '必填开启' : item.isEnabled ? '已启用' : '已隐藏' }}
              </span>
            </label>
          </div>
        </div>
      </div>
    </div>

    <!-- Tab 2: General Sound & Pronunciation Defaults -->
    <div v-else-if="activeTab === 'general'" class="space-y-4">
      <div class="p-6 rounded-2xl bg-[#141826] border border-[#22283e] space-y-5">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="text-sm font-semibold text-white">默认全局发音人与音色设置</h3>
            <p class="text-xs text-slate-400 mt-1">全局发音人在前台练习、拆句练习、复习本、收藏夹与后台试听中保持统一同步。</p>
          </div>
          <button
            @click="handleResetSettings"
            class="text-xs text-slate-400 hover:text-white flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1e2438] hover:bg-[#252d47] transition-colors cursor-pointer"
          >
            <RotateCcw class="w-3.5 h-3.5" />
            <span>恢复默认设置</span>
          </button>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <!-- Voice Selector -->
          <div class="p-4 rounded-xl bg-[#1a1f33] border border-[#27304e] space-y-3">
            <div class="flex items-center justify-between">
              <span class="text-xs font-semibold text-slate-200">默认发音人音色</span>
              <span class="text-[11px] px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono">
                {{ settingsStore.settings.pronunciation.voice }}
              </span>
            </div>
            <div class="flex items-center gap-2">
              <CustomSelect
                v-model="settingsStore.settings.pronunciation.voice"
                :options="voiceOptions"
                @change="onVoiceChange"
                class="flex-1"
              />
              <button
                @click="auditionTTS"
                class="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs cursor-pointer flex items-center gap-1.5 font-semibold transition-colors shrink-0 shadow-lg shadow-indigo-600/20"
                title="试听发音效果"
              >
                <Volume2 class="w-3.5 h-3.5" />
                <span>试听</span>
              </button>
            </div>
            <p class="text-[11px] text-slate-400">
              包含原生男女及童声专用声调曲线（0.70x~1.55x Pitch 自适应），单音色系统亦能分明辨识男声、女声与童声。
            </p>
          </div>

          <!-- Speed & Volume -->
          <div class="p-4 rounded-xl bg-[#1a1f33] border border-[#27304e] space-y-3.5">
            <span class="text-xs font-semibold text-slate-200 block">发音速率与音量</span>
            <!-- Speed -->
            <div class="flex items-center justify-between text-xs">
              <span class="text-slate-300">默认朗读语速</span>
              <div class="flex items-center gap-3">
                <input
                  type="range"
                  min="0.5"
                  max="2.0"
                  step="0.1"
                  v-model.number="settingsStore.settings.pronunciation.speed"
                  @input="settingsStore.debouncedSave()"
                  class="w-28 accent-indigo-500 cursor-pointer"
                />
                <span class="font-bold text-indigo-400 font-mono w-10 text-right">{{ settingsStore.settings.pronunciation.speed }}x</span>
              </div>
            </div>
            <!-- Volume -->
            <div class="flex items-center justify-between text-xs">
              <span class="text-slate-300">默认朗读音量</span>
              <div class="flex items-center gap-3">
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  v-model.number="settingsStore.settings.pronunciation.volume"
                  @input="settingsStore.debouncedSave()"
                  class="w-28 accent-indigo-500 cursor-pointer"
                />
                <span class="font-bold text-indigo-400 font-mono w-10 text-right">{{ settingsStore.settings.pronunciation.volume }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Automation toggles -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div class="p-4 rounded-xl bg-[#1a1f33] border border-[#27304e] flex items-center justify-between">
            <div>
              <div class="font-medium text-slate-200">切题后自动朗读</div>
              <div class="text-[11px] text-slate-400 mt-0.5">继续练习、切题进入下一题时自动触发朗读</div>
            </div>
            <input
              type="checkbox"
              v-model="settingsStore.settings.pronunciation.autoReadOnSwitch"
              @change="settingsStore.debouncedSave()"
              class="w-4 h-4 accent-indigo-600 rounded cursor-pointer"
            />
          </div>

          <div class="p-4 rounded-xl bg-[#1a1f33] border border-[#27304e] flex items-center justify-between">
            <div>
              <div class="font-medium text-slate-200">答题正确后朗读</div>
              <div class="text-[11px] text-slate-400 mt-0.5">输入全部敲击正确后自动朗读整句</div>
            </div>
            <input
              type="checkbox"
              v-model="settingsStore.settings.pronunciation.autoReadOnCorrect"
              @change="settingsStore.debouncedSave()"
              class="w-4 h-4 accent-indigo-600 rounded cursor-pointer"
            />
          </div>
        </div>

        <!-- Repeat Count & Interval -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div class="p-4 rounded-xl bg-[#1a1f33] border border-[#27304e] flex items-center justify-between">
            <div>
              <div class="font-medium text-slate-200">朗读重复次数</div>
              <div class="text-[11px] text-slate-400 mt-0.5">每题自动朗读的重复播报次数（1-5次）</div>
            </div>
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

          <div class="p-4 rounded-xl bg-[#1a1f33] border border-[#27304e] flex items-center justify-between">
            <div>
              <div class="font-medium text-slate-200">朗读间隔秒数</div>
              <div class="text-[11px] text-slate-400 mt-0.5">多次重复朗读之间的缓冲静音时间（0-5秒）</div>
            </div>
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
        </div>

        <!-- Info Cards -->
        <div class="grid grid-cols-2 gap-4 text-xs pt-2">
          <div class="p-4 rounded-xl bg-[#1a1f33]/60 border border-[#27304e]/70 space-y-1.5">
            <div class="text-slate-400 font-medium">发音引擎内核</div>
            <div class="text-indigo-400 font-bold flex items-center gap-1.5">
              <Sparkles class="w-3.5 h-3.5" />
              <span>Web Speech API + Edge Neural 混合调度</span>
            </div>
          </div>
          <div class="p-4 rounded-xl bg-[#1a1f33]/60 border border-[#27304e]/70 space-y-1.5">
            <div class="text-slate-400 font-medium">SSML 音标标签解析与音调控制</div>
            <div class="text-emerald-400 font-bold">已启用（结合题目音标精准发音）</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Tab 3: Theme -->
    <div v-else class="space-y-6">
      <div class="p-6 rounded-2xl bg-[#141826] border border-[#22283e] space-y-6">
        <div>
          <h2 class="text-sm font-semibold text-white">平台主题模式</h2>
          <p class="text-xs text-slate-400 mt-1">
            选择符合您视觉习惯的界面配色模式。切换后将实时生效并自动持久化至个人账户。
          </p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <!-- Dark Mode Card -->
          <div
            @click="settingsStore.setTheme('dark')"
            :class="[
              'p-5 rounded-2xl border transition-all cursor-pointer relative flex flex-col justify-between gap-4 group',
              settingsStore.settings.personalization?.theme !== 'light'
                ? 'bg-indigo-950/30 border-indigo-500/60 shadow-lg shadow-indigo-500/10'
                : 'bg-[#181c2b] border-[#22283e] hover:border-[#2f3856]'
            ]"
          >
            <div class="flex items-start justify-between">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl bg-slate-900 border border-slate-700/60 flex items-center justify-center text-indigo-400">
                  <Moon class="w-5 h-5" />
                </div>
                <div>
                  <div class="text-sm font-bold text-white flex items-center gap-2">
                    <span>极客深色模式</span>
                    <span v-if="settingsStore.settings.personalization?.theme !== 'light'" class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                      当前使用
                    </span>
                  </div>
                  <div class="text-xs text-slate-400 mt-0.5">深邃沉浸 · 视力保护 · 荧光聚焦</div>
                </div>
              </div>
            </div>

            <!-- Preview box -->
            <div class="h-16 rounded-xl bg-[#0a0c13] border border-[#1e2335] p-3 flex items-center justify-between text-xs">
              <div class="flex items-center gap-2">
                <div class="w-3 h-3 rounded-full bg-indigo-500"></div>
                <span class="text-slate-300 font-mono">#0a0c13 暗夜背景</span>
              </div>
              <span class="text-indigo-400 font-mono">深色高对比</span>
            </div>
          </div>

          <!-- Light Mode Card -->
          <div
            @click="settingsStore.setTheme('light')"
            :class="[
              'p-5 rounded-2xl border transition-all cursor-pointer relative flex flex-col justify-between gap-4 group',
              settingsStore.settings.personalization?.theme === 'light'
                ? 'bg-indigo-950/30 border-indigo-500/60 shadow-lg shadow-indigo-500/10'
                : 'bg-[#181c2b] border-[#22283e] hover:border-[#2f3856]'
            ]"
          >
            <div class="flex items-start justify-between">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200/80 flex items-center justify-center text-amber-500">
                  <Sun class="w-5 h-5" />
                </div>
                <div>
                  <div class="text-sm font-bold text-white flex items-center gap-2">
                    <span>纯净浅色模式</span>
                    <span v-if="settingsStore.settings.personalization?.theme === 'light'" class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      当前使用
                    </span>
                  </div>
                  <div class="text-xs text-slate-400 mt-0.5">纯白雅致 · 清新通透 · 日光自适应</div>
                </div>
              </div>
            </div>

            <!-- Preview box -->
            <div class="h-16 rounded-xl bg-white border border-slate-200 p-3 flex items-center justify-between text-xs">
              <div class="flex items-center gap-2">
                <div class="w-3 h-3 rounded-full bg-amber-400"></div>
                <span class="text-slate-700 font-mono">#ffffff 纯白基底</span>
              </div>
              <span class="text-blue-600 font-mono">清爽白调</span>
            </div>
          </div>
        </div>

        <div class="p-4 rounded-xl bg-[#1a1f33]/60 border border-[#27304e]/70 text-xs text-slate-300">
          <p>💡 提示：您也可以随时点击左侧侧边栏底部的“浅色模式 / 深色模式”快捷按钮，或顶部导航栏的太阳/月亮图标直接切换。</p>
        </div>
      </div>
    </div>
  </div>
</template>
