<script setup lang="ts">
import { userFetch } from '../utils/userApi'
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '../stores/userStore'
import { useSettingsStore } from '../stores/settingsStore'
import {
  AlertTriangle,
  Heart,
  ChevronLeft,
  ChevronRight,
  Share2,
  Play,
  CheckCircle2,
  X,
  Download,
  Copy,
} from 'lucide-vue-next'
import * as echarts from 'echarts'

const router = useRouter()
const userStore = useUserStore()
const settingsStore = useSettingsStore()

const chartRef = ref<HTMLDivElement | null>(null)
let chartInstance: echarts.ECharts | null = null
const currentMonth = ref('2026-09')
const showPhilosophyModal = ref(false)
const showShareModal = ref(false)
const toastMsg = ref('')

interface RecentProgress {
  courseId: string
  courseTitle: string
  lessonId: string
  lessonTitle: string
  lessonNumber: number
  totalLessons: number
  sentenceIndex: number
  totalSentences: number
  progressPercent: number
}

const recentProgress = ref<RecentProgress | null>(null)

async function fetchRecentProgress() {
  try {
    const res = await userFetch('/api/user/progress/recent?userId=8723192')
    if (res.ok) {
      const data = await res.json()
      if (data && data.success && data.progress) {
        recentProgress.value = data.progress
      }
    }
  } catch (err) {
    console.error('Failed to fetch recent progress:', err)
  }
}

function formatSeconds(totalSecs: number) {
  const mins = Math.floor(totalSecs / 60)
  const secs = totalSecs % 60
  if (mins === 0) return `${secs}秒`
  return `${mins}分${secs}秒`
}

function continuePractice() {
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    try {
      window.speechSynthesis.resume()
    } catch {}
  }
  if (recentProgress.value && recentProgress.value.courseId && recentProgress.value.lessonId) {
    router.push(`/practice/${recentProgress.value.courseId}/${recentProgress.value.lessonId}?sentence=${recentProgress.value.sentenceIndex}`)
  } else {
    router.push('/practice/c_700/lesson_700_1')
  }
}

function initChart() {
  if (!chartRef.value) return
  if (chartInstance) {
    chartInstance.dispose()
  }
  chartInstance = echarts.init(chartRef.value)

  const isLight = settingsStore.settings.personalization?.theme === 'light' || (typeof document !== 'undefined' && document.documentElement.classList.contains('light'))

  // Generate 30 days
  const days = Array.from({ length: 30 }, (_, i) => String(i + 1).padStart(2, '0'))
  // Day 22 has 2 minutes (118s), others 0
  const data = days.map((day) => {
    if (day === '22') return 2
    return 0.2 // Small grey placeholder
  })

  const option: echarts.EChartsOption = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: unknown) => {
        const item = (params as Array<{ name: string; value: number }>)[0]
        if (!item) return ''
        const val = item.value <= 0.2 ? 0 : item.value
        return `${currentMonth.value}-${item.name}<br/>学习时长：${val} 分钟`
      },
      backgroundColor: isLight ? '#ffffff' : '#1c2237',
      borderColor: isLight ? '#e2e8f0' : '#303956',
      textStyle: { color: isLight ? '#0f172a' : '#f1f5f9' },
    },
    grid: {
      left: '1%',
      right: '1%',
      top: '10%',
      bottom: '5%',
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      data: days,
      axisLine: { lineStyle: { color: isLight ? '#e2e8f0' : '#252b41' } },
      axisTick: { show: false },
      axisLabel: { color: '#64748b', fontSize: 11 },
    },
    yAxis: {
      type: 'value',
      show: false,
    },
    series: [
      {
        type: 'bar',
        barWidth: '60%',
        data: data.map((val, idx) => ({
          value: val,
          itemStyle: {
            color: idx === 21 ? '#6366f1' : (isLight ? '#e2e8f0' : '#1e2436'), // Day 22 is highlighted indigo, others light gray in light mode
            borderRadius: [4, 4, 0, 0],
          },
        })),
      },
    ],
  }

  chartInstance.setOption(option)
}

function handleResize() {
  chartInstance?.resize()
}

watch(
  () => settingsStore.settings.personalization?.theme,
  () => {
    initChart()
  }
)

onMounted(async () => {
  await userStore.fetchProfile()
  await fetchRecentProgress()
  initChart()
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  chartInstance?.dispose()
})

function copyShareLink() {
  navigator.clipboard.writeText('https://yanxidao.com/share/' + userStore.profile.id)
  toastMsg.value = '分享链接已复制！'
  setTimeout(() => {
    toastMsg.value = ''
  }, 2000)
}
</script>

<template>
  <div class="p-8 space-y-6 max-w-7xl mx-auto select-none">
    <!-- Usage Guidance Banner -->
    <div class="flex items-center gap-3 px-5 py-3.5 rounded-xl bg-[#181c2b] border border-[#272d45] text-xs">
      <AlertTriangle class="w-4 h-4 text-amber-400 shrink-0" />
      <span class="text-amber-400 font-bold">最佳使用方式：</span>
      <span class="text-slate-300">
        请在“电脑”或“Pad+键盘”上使用，并打开声音，学习更加有趣，效率更高，根本停不下来。
      </span>
    </div>

    <!-- Section 1: Study Duration Cards -->
    <div class="space-y-3">
      <div class="flex items-center gap-2 text-sm font-semibold text-slate-300">
        <div class="w-2 h-2 rounded-full bg-blue-500"></div>
        <span>学习时长</span>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
        <!-- Card 1: Total Study Time -->
        <div class="p-5 rounded-2xl bg-[#141826] border border-[#22283e] flex flex-col justify-center">
          <div class="text-xs text-slate-400 mb-2">累计学习时长</div>
          <div class="text-2xl font-bold text-white tracking-tight">
            {{ formatSeconds(userStore.profile.totalStudySeconds) }}
          </div>
        </div>

        <!-- Card 2: Today Study Time -->
        <div class="p-5 rounded-2xl bg-[#141826] border border-[#22283e] flex flex-col justify-center">
          <div class="text-xs text-slate-400 mb-2">今日学习时长</div>
          <div class="text-2xl font-bold text-white tracking-tight">
            {{ formatSeconds(userStore.profile.todayStudySeconds) }}
          </div>
        </div>

        <!-- Card 3: Month Study Time -->
        <div class="p-5 rounded-2xl bg-[#141826] border border-[#22283e] flex flex-col justify-center">
          <div class="text-xs text-slate-400 mb-2">本月学习时长</div>
          <div class="text-2xl font-bold text-white tracking-tight">
            {{ formatSeconds(userStore.profile.monthStudySeconds) }}
          </div>
        </div>

        <!-- Card 4: Last Practiced Resume -->
        <div class="p-5 rounded-2xl bg-[#141826] border border-[#22283e] flex flex-col justify-between">
          <div class="text-xs text-slate-400 mb-1 flex items-center justify-between">
            <span>上次练习</span>
            <span v-if="recentProgress" class="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-semibold font-mono">
              {{ recentProgress.progressPercent }}%
            </span>
          </div>
          <div v-if="recentProgress" class="space-y-0.5">
            <div class="flex items-center gap-2 text-sm font-bold text-slate-100 truncate">
              <Play class="w-3.5 h-3.5 text-indigo-400 fill-indigo-400 shrink-0" />
              <span class="truncate">{{ recentProgress.courseTitle }}</span>
            </div>
            <div class="text-[11px] text-slate-400 truncate">
              第 {{ recentProgress.lessonNumber }} 课 · 第 {{ recentProgress.sentenceIndex + 1 }}/{{ recentProgress.totalSentences }} 题
            </div>
          </div>
          <div v-else class="flex items-center gap-2 text-sm font-medium text-slate-200 truncate">
            <Play class="w-3.5 h-3.5 text-indigo-400 fill-indigo-400 shrink-0" />
            <span class="truncate">高频英语700句全场景通关</span>
          </div>
          <button
            @click="continuePractice"
            class="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-400 hover:text-indigo-300 transition-colors cursor-pointer"
          >
            <span>继续练习 -></span>
          </button>
        </div>
      </div>
    </div>

    <!-- Platform Philosophy Bar -->
    <div class="flex items-center justify-between px-6 py-4 rounded-2xl bg-[#141826] border border-[#22283e]">
      <div class="flex items-center gap-3">
        <div class="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center">
          <CheckCircle2 class="w-4 h-4" />
        </div>
        <span class="text-sm text-slate-300">我们不想让英语变得更难，我们只想让你敲着敲着就会了。</span>
      </div>
      <button
        @click="showPhilosophyModal = true"
        class="px-4 py-1.5 rounded-xl bg-[#20263c] hover:bg-[#2b3452] text-xs font-semibold text-slate-200 border border-[#2d3652] transition-colors cursor-pointer"
      >
        我们的初心
      </button>
    </div>

    <!-- Section 2: Study Achievements Cards -->
    <div class="space-y-3">
      <div class="flex items-center gap-2 text-sm font-semibold text-slate-300">
        <div class="w-2 h-2 rounded-full bg-indigo-500"></div>
        <span>学习成就</span>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
        <!-- Card 1: Total Sentences -->
        <div class="p-5 rounded-2xl bg-[#141826] border border-[#22283e] flex flex-col justify-center">
          <div class="text-xs text-slate-400 mb-2">累计练习句子次数</div>
          <div class="text-2xl font-bold text-white tracking-tight">
            {{ userStore.profile.totalSentenceCount }}
          </div>
        </div>

        <!-- Card 2: Today Sentences -->
        <div class="p-5 rounded-2xl bg-[#141826] border border-[#22283e] flex flex-col justify-center">
          <div class="text-xs text-slate-400 mb-2">今日练习句子数量</div>
          <div class="text-2xl font-bold text-white tracking-tight">
            {{ userStore.profile.todaySentenceCount }}
          </div>
        </div>

        <!-- Card 3: Continuous Days -->
        <div class="p-5 rounded-2xl bg-[#141826] border border-[#22283e] flex flex-col justify-center">
          <div class="text-xs text-slate-400 mb-2">连续学习天数</div>
          <div class="text-2xl font-bold text-white tracking-tight">
            {{ userStore.profile.continuousDays }}
          </div>
        </div>

        <!-- Card 4: Share Poster Trigger -->
        <div class="p-5 rounded-2xl bg-[#141826] border border-[#22283e] flex flex-col justify-between">
          <div class="text-xs text-slate-400 mb-2">分享战报</div>
          <button
            @click="showShareModal = true"
            class="share-achievement-btn w-full py-2.5 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white font-semibold text-xs shadow-lg shadow-indigo-500/25 flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <Share2 class="w-3.5 h-3.5" />
            <span>分享成就</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Section 3: Study Time Distribution Bar Chart -->
    <div class="p-6 rounded-2xl bg-[#141826] border border-[#22283e] space-y-4">
      <div class="flex items-center justify-between">
        <div class="text-sm font-semibold text-slate-200">学习时段分布</div>
        <div class="flex items-center gap-2 text-xs text-slate-400">
          <span class="px-2.5 py-1 rounded bg-[#1e2436] font-mono text-slate-300">{{ currentMonth }}</span>
          <div class="flex items-center gap-1">
            <button class="p-1 rounded hover:bg-[#20273c] text-slate-400 hover:text-white transition-colors">
              <ChevronLeft class="w-4 h-4" />
            </button>
            <button class="p-1 rounded hover:bg-[#20273c] text-slate-400 hover:text-white transition-colors">
              <ChevronRight class="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <!-- Chart Container -->
      <div ref="chartRef" class="w-full h-48"></div>
    </div>

    <!-- Philosophy Modal -->
    <div
      v-if="showPhilosophyModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      @click.self="showPhilosophyModal = false"
    >
      <div class="w-full max-w-md bg-[#181c2b] border border-[#272d45] rounded-2xl p-6 shadow-2xl space-y-4">
        <div class="flex items-center justify-between border-b border-[#242a40] pb-3">
          <h3 class="text-base font-bold text-white flex items-center gap-2">
            <Heart class="w-4 h-4 text-pink-500 fill-pink-500" />
            <span>我们的初心</span>
          </h3>
          <button @click="showPhilosophyModal = false" class="text-slate-400 hover:text-white">
            <X class="w-5 h-5" />
          </button>
        </div>
        <div class="text-sm text-slate-300 leading-relaxed space-y-2">
          <p>学英语不应该是一场痛苦的死记硬背。</p>
          <p>研习岛坚信：通过肌肉记忆、纯正 TTS 语音实时反馈、指法引导以及沉浸式的打字练习，你可以像玩游戏通关一样轻松掌握地道表达。</p>
          <p class="text-indigo-400 font-medium">敲着敲着，英语自然印在脑海里。</p>
        </div>
        <button
          @click="showPhilosophyModal = false"
          class="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs mt-2"
        >
          开始敲击探索
        </button>
      </div>
    </div>

    <!-- Share Poster Modal -->
    <div
      v-if="showShareModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      @click.self="showShareModal = false"
    >
      <div class="w-full max-w-sm bg-[#181c2b] border border-[#272d45] rounded-2xl p-6 shadow-2xl space-y-4 text-center">
        <div class="flex items-center justify-between border-b border-[#242a40] pb-3 text-left">
          <span class="text-sm font-bold text-white">学习战报分享</span>
          <button @click="showShareModal = false" class="text-slate-400 hover:text-white">
            <X class="w-5 h-5" />
          </button>
        </div>

        <!-- Poster Card Preview -->
        <div class="p-6 rounded-2xl bg-gradient-to-br from-[#1d2238] to-[#121522] border border-[#2d3554] space-y-4">
          <div class="user-avatar-wrap w-16 h-16 mx-auto rounded-full overflow-hidden ring-4 ring-indigo-500/30 flex items-center justify-center">
            <img :src="userStore.profile.avatar" class="user-avatar-img w-full h-full object-cover" />
          </div>
          <div>
            <div class="font-bold text-white text-base">{{ userStore.profile.nickname }}</div>
            <div class="text-xs text-indigo-400 mt-0.5">在研习岛已连续打卡 {{ userStore.profile.continuousDays }} 天</div>
          </div>

          <div class="grid grid-cols-2 gap-3 py-3 border-y border-[#293049] text-left">
            <div>
              <div class="text-[11px] text-slate-400">已敲击句子</div>
              <div class="text-lg font-bold text-white">{{ userStore.profile.totalSentenceCount }} 句</div>
            </div>
            <div>
              <div class="text-[11px] text-slate-400">专注学习</div>
              <div class="text-lg font-bold text-white">{{ formatSeconds(userStore.profile.totalStudySeconds) }}</div>
            </div>
          </div>

          <div class="flex items-center justify-between text-xs text-slate-400 pt-1">
            <span>扫码加入研习岛</span>
            <div class="w-12 h-12 bg-white rounded-lg p-1 flex items-center justify-center text-black font-bold text-[10px]">
              QR CODE
            </div>
          </div>
        </div>

        <div v-if="toastMsg" class="text-xs text-emerald-400 font-medium">
          {{ toastMsg }}
        </div>

        <div class="flex items-center gap-3">
          <button
            @click="copyShareLink"
            class="flex-1 py-2.5 rounded-xl bg-[#23293f] hover:bg-[#2e3754] text-xs font-semibold text-slate-200 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          >
            <Copy class="w-3.5 h-3.5" />
            <span>复制链接</span>
          </button>
          <button
            @click="toastMsg = '战报海报已保存至相册！'"
            class="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          >
            <Download class="w-3.5 h-3.5" />
            <span>保存图片</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
