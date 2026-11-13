<script setup lang="ts">
import { userFetch } from '../utils/userApi'
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useCourseStore } from '../stores/courseStore'
import { ArrowLeft, Star, Play, Clock, CheckCircle2, Check } from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const courseStore = useCourseStore()

const toastMsg = ref('')

const courseId = computed(() => route.params.id as string)
const course = computed(() => courseStore.currentCourse?.id === courseId.value ? courseStore.currentCourse : courseStore.getCourseById(courseId.value))

const lessons = computed(() => {
  return courseStore.getLessonsByCourseId(courseId.value)
})

interface UserProgress {
  lessonId: string
  sentenceIndex: number
  totalSentences: number
  progressPercent: number
  lessonTitle: string
  lessonNumber: number
  lastPracticedAt: string
}

const userProgress = ref<UserProgress | null>(null)

async function fetchUserProgress() {
  try {
    const res = await userFetch(`/api/user/progress?courseId=${courseId.value}&userId=8723192`)
    if (res.ok) {
      userProgress.value = await res.json()
    }
  } catch (err) {
    console.error('Failed to fetch user progress:', err)
  }
}

onMounted(async () => {
  if (courseId.value) {
    await courseStore.fetchCourseDetails(courseId.value)
    await fetchUserProgress()
  }
})

async function handleToggleFavorite() {
  if (!course.value) return
  const isFav = await courseStore.toggleFavorite(course.value.id)
  toastMsg.value = isFav ? '已添加到我的收藏' : '已从我的收藏移除'
  setTimeout(() => { toastMsg.value = '' }, 2000)
}

function goBack() {
  router.back()
}

function startLesson(lesson: { id: string; sentenceCount?: number }) {
  if (lesson.sentenceCount !== undefined && lesson.sentenceCount === 0) {
    alert('该课时暂未导入题目内容，请在后台管理系统中为此课时导入题库！')
    return
  }
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    try {
      window.speechSynthesis.resume()
    } catch {}
  }
  const sentenceParam = userProgress.value && userProgress.value.lessonId === lesson.id
    ? `?sentence=${userProgress.value.sentenceIndex}`
    : ''
  router.push(`/practice/${courseId.value}/${lesson.id}${sentenceParam}`)
}

function handleContinueLearning() {
  if (userProgress.value && userProgress.value.lessonId) {
    const targetLesson = lessons.value.find(l => l.id === userProgress.value!.lessonId)
    if (targetLesson && (targetLesson.sentenceCount === undefined || targetLesson.sentenceCount > 0)) {
      router.push(`/practice/${courseId.value}/${userProgress.value.lessonId}?sentence=${userProgress.value.sentenceIndex}`)
      return
    }
  }

  // Find first lesson with actual sentences
  const activeLesson = lessons.value.find(l => (l.sentenceCount || 0) > 0) || lessons.value[0]
  if (activeLesson) {
    startLesson(activeLesson)
  } else {
    alert('该课程暂无已导入题目的课时，请先在后台管理系统中导入题目！')
  }
}

function formatDuration(seconds: number) {
  if (!seconds || seconds <= 0) return '0秒'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m === 0) return `${s}秒`
  if (s === 0) return `${m}分钟`
  return `${m}分${s}秒`
}
</script>

<template>
  <div v-if="course" class="p-8 space-y-6 max-w-7xl mx-auto select-none">
    <!-- Toast Notification -->
    <div v-if="toastMsg" class="px-4 py-2 rounded-xl bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 text-xs flex items-center gap-2 animate-fade-in w-fit">
      <Check class="w-4 h-4 text-indigo-400" />
      <span>{{ toastMsg }}</span>
    </div>

    <!-- Top Return & Header Card -->
    <div class="p-6 rounded-2xl bg-[#141826] border border-[#22283e] flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
      <div class="flex items-center gap-5">
        <!-- Cover -->
        <div class="w-20 h-28 rounded-xl overflow-hidden bg-slate-800 shrink-0 shadow-lg">
          <img :src="course.cover" :alt="course.title" class="w-full h-full object-cover" />
        </div>

        <!-- Meta -->
        <div class="space-y-2">
          <div class="text-lg font-bold text-white tracking-wide">
            {{ course.title }}
          </div>
          <div class="flex items-center gap-4 text-xs text-slate-400">
            <div class="flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-blue-400"></span>
              <span>主讲教师: {{ course.instructor.name }}</span>
            </div>
            <span>总计 {{ course.lessonCount }} 小节</span>
            <span>已入库 {{ lessons.filter(l => (l.sentenceCount || 0) > 0).length }} 个训练课时</span>
          </div>
          <!-- Action Buttons -->
          <div class="flex items-center gap-3 pt-1">
            <button
              @click="handleContinueLearning"
              class="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center gap-2 shadow-lg shadow-indigo-600/30 transition-all cursor-pointer"
            >
              <Play class="w-3.5 h-3.5 fill-white" />
              <span>开始 / 继续学习</span>
            </button>
            <button
              @click="handleToggleFavorite"
              :class="[
                'px-4 py-2 rounded-xl border text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer',
                course.isFavorite
                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                  : 'bg-[#1e2338] border-[#293049] text-slate-300 hover:text-white'
              ]"
            >
              <Star :class="['w-3.5 h-3.5', course.isFavorite ? 'fill-amber-400 text-amber-400' : 'text-slate-400']" />
              <span>{{ course.isFavorite ? '已收藏' : '收藏' }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Return Button & Progress -->
      <div class="flex flex-col items-end gap-4 w-full md:w-auto">
        <button
          @click="goBack"
          class="px-4 py-2 rounded-xl bg-[#1c2237] hover:bg-[#252c46] border border-[#272e47] text-xs font-semibold text-slate-300 flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          <ArrowLeft class="w-4 h-4" />
          <span>返回上一层</span>
        </button>
        <div class="text-xs text-slate-400">
          已完成练习 {{ lessons.filter(l => l.completedCount > 0).length }} / {{ lessons.length }} 节
        </div>
      </div>
    </div>

    <!-- Personal Learning Progress Banner (SRS) -->
    <div v-if="userProgress" class="user-progress-banner p-5 rounded-2xl bg-gradient-to-r from-indigo-950/60 to-purple-950/40 border border-indigo-500/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-lg shadow-indigo-950/30">
      <div class="flex items-center gap-3.5">
        <div class="w-10 h-10 rounded-xl bg-indigo-600/30 border border-indigo-500/50 flex items-center justify-center text-indigo-300 shrink-0">
          <Play class="w-5 h-5 fill-indigo-400" />
        </div>
        <div>
          <div class="flex items-center gap-2">
            <span class="user-progress-banner-title text-xs font-bold text-white">个人上次练习进度已保存</span>
            <span class="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-semibold border border-indigo-500/30">
              已学 {{ userProgress.progressPercent }}%
            </span>
          </div>
          <div class="text-xs text-slate-300 mt-1">
            上次学至第 {{ userProgress.lessonNumber }} 课 · 第 {{ userProgress.sentenceIndex + 1 }} / {{ userProgress.totalSentences }} 题
            <span v-if="userProgress.lessonTitle" class="text-slate-400">（{{ userProgress.lessonTitle }}）</span>
          </div>
        </div>
      </div>
      <button
        @click="handleContinueLearning"
        class="user-progress-continue-btn px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-2 transition-all shadow-md shadow-indigo-600/40 cursor-pointer shrink-0"
      >
        <span class="text-white font-bold">继续上次进度</span>
        <Play class="w-3.5 h-3.5 fill-white text-white" />
      </button>
    </div>

    <!-- Section Cards Grid -->
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <div class="text-sm font-semibold text-slate-300">小节训练列表（共 {{ lessons.length }} 节）</div>
        <div class="text-xs text-slate-500">点击任意小节直接进入沉浸式练习</div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        <div
          v-for="lesson in lessons"
          :key="lesson.id"
          @click="startLesson(lesson)"
          :class="[
            'p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between h-40 relative group',
            userProgress && userProgress.lessonId === lesson.id
              ? 'bg-[#181d33] border-indigo-500 shadow-lg shadow-indigo-950/60 ring-1 ring-indigo-500/50'
              : lesson.isRecent
              ? 'bg-[#161c2e] border-indigo-500/80 shadow-lg shadow-indigo-950/50'
              : 'bg-[#141826] border-[#22283e] hover:border-[#323b5c]'
          ]"
        >
          <div>
            <div class="flex items-center justify-between text-[11px] mb-1.5">
              <span class="font-mono text-slate-400">#{{ lesson.lessonNumber }}</span>
              <span
                v-if="userProgress && userProgress.lessonId === lesson.id"
                class="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-semibold text-[10px] border border-indigo-500/40 flex items-center gap-1"
              >
                <Play class="w-2.5 h-2.5 fill-indigo-400" />
                <span>上次学至第 {{ userProgress.sentenceIndex + 1 }} 题</span>
              </span>
              <span
                v-else-if="(lesson.sentenceCount || 0) > 0"
                class="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 font-semibold text-[10px] border border-emerald-500/30 flex items-center gap-1"
              >
                <CheckCircle2 class="w-3 h-3" />
                <span>{{ lesson.sentenceCount }} 题</span>
              </span>
              <span
                v-else
                class="px-2 py-0.5 rounded-full bg-[#1c2132] text-slate-500 font-medium text-[10px]"
              >
                待导入题库
              </span>
            </div>
            <div class="text-xs font-bold text-slate-100 group-hover:text-indigo-300 transition-colors line-clamp-1">
              {{ lesson.titleEn }}
            </div>
            <div class="text-[11px] text-slate-400 mt-1 line-clamp-2">
              {{ lesson.titleCn }}
            </div>
          </div>

          <div class="flex items-center justify-between text-[11px] text-slate-500 border-t border-[#1e2336] pt-2">
            <span class="flex items-center gap-1">
              <Clock class="w-3 h-3 text-slate-400" />
              时长：{{ formatDuration(lesson.practiceTimeSeconds) }}
            </span>
            <span>已完成 {{ lesson.completedCount }} 次</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
