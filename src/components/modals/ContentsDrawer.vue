<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { usePracticeStore } from '../../stores/practiceStore'
import { useCourseStore } from '../../stores/courseStore'
import { X, CheckCircle2, Clock } from 'lucide-vue-next'

const router = useRouter()
const practiceStore = usePracticeStore()
const courseStore = useCourseStore()

const activeTab = ref<'sentences' | 'lessons'>('sentences')

const currentCourseId = computed(() => practiceStore.currentLesson?.courseId || '')
const courseLessons = computed(() => {
  if (!currentCourseId.value) return []
  return courseStore.getLessonsByCourseId(currentCourseId.value)
})

function selectSentence(index: number) {
  practiceStore.jumpToSentence(index)
}

function switchToLesson(lessonId: string) {
  practiceStore.showContentsDrawer = false
  router.push(`/practice/${currentCourseId.value}/${lessonId}`)
}

function formatDuration(seconds: number) {
  if (!seconds || seconds <= 0) return '0秒'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m === 0) return `${s}秒`
  return `${m}分${s}秒`
}
</script>

<template>
  <div
    v-if="practiceStore.showContentsDrawer"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 select-none"
    @click.self="practiceStore.showContentsDrawer = false"
  >
    <div class="w-full max-w-lg bg-[#181c2b] border border-[#272d45] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-[#252b41]">
        <div class="flex items-center gap-3">
          <h3 class="text-sm font-bold text-white">学习内容导航</h3>
          <!-- Tabs -->
          <div class="drawer-tabs-wrapper flex items-center gap-1 bg-[#101422] p-0.5 rounded-lg border border-[#22283e]">
            <button
              @click="activeTab = 'sentences'"
              :class="[
                'px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer',
                activeTab === 'sentences' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
              ]"
            >
              本课题目 ({{ practiceStore.currentLesson?.sentences?.length || 0 }})
            </button>
            <button
              @click="activeTab = 'lessons'"
              :class="[
                'px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer',
                activeTab === 'lessons' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
              ]"
            >
              课程全课时 ({{ courseLessons.length }})
            </button>
          </div>
        </div>
        <button
          @click="practiceStore.showContentsDrawer = false"
          class="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-[#23293f] transition-colors cursor-pointer"
        >
          <X class="w-5 h-5" />
        </button>
      </div>

      <!-- Tab 1: Current Lesson Sentences List -->
      <div v-if="activeTab === 'sentences'" class="p-4 space-y-2.5 overflow-y-auto flex-1">
        <div
          v-for="(s, idx) in practiceStore.currentLesson?.sentences || []"
          :key="s.index"
          @click="selectSentence(idx)"
          :class="[
            'p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between group',
            idx === practiceStore.currentSentenceIndex
              ? 'drawer-item-active bg-[#222a44] border-indigo-500/80 shadow-md shadow-indigo-950/50'
              : 'bg-[#151928] border-[#22283e] hover:bg-[#1a1f33]'
          ]"
        >
          <div class="min-w-0 pr-2">
            <div class="text-xs font-bold text-slate-100 group-hover:text-indigo-300 transition-colors truncate">
              {{ s.sentenceEn }}
            </div>
            <div class="text-[11px] text-slate-400 mt-1 truncate">
              {{ s.sentenceCn }}
            </div>
          </div>
          <span
            :class="[
              'drawer-index-tag px-2 py-0.5 rounded text-xs font-mono font-semibold shrink-0 transition-colors',
              idx === practiceStore.currentSentenceIndex
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-[#20263b] text-slate-400'
            ]"
          >
            #{{ s.index }}
          </span>
        </div>
      </div>

      <!-- Tab 2: Full Course Lessons List -->
      <div v-else class="p-4 space-y-2.5 overflow-y-auto flex-1">
        <div
          v-for="l in courseLessons"
          :key="l.id"
          @click="switchToLesson(l.id)"
          :class="[
            'p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between group',
            l.id === practiceStore.currentLesson?.id
              ? 'drawer-item-active bg-[#222a44] border-indigo-500/80 shadow-md shadow-indigo-950/50'
              : 'bg-[#151928] border-[#22283e] hover:bg-[#1a1f33]'
          ]"
        >
          <div class="min-w-0 pr-2">
            <div class="flex items-center gap-2">
              <span class="text-indigo-400 font-mono text-xs font-bold">#{{ l.lessonNumber }}</span>
              <span class="text-xs font-bold text-slate-100 group-hover:text-indigo-300 transition-colors truncate">
                {{ l.titleEn }}
              </span>
            </div>
            <div class="text-[11px] text-slate-400 mt-1 truncate pl-5">
              {{ l.titleCn }}
            </div>
            <div class="flex items-center gap-3 text-[10px] text-slate-500 mt-1.5 pl-5">
              <span class="text-emerald-400 font-medium flex items-center gap-1">
                <CheckCircle2 class="w-3 h-3" />
                {{ l.sentenceCount || l.sentences?.length || 0 }} 题
              </span>
              <span class="flex items-center gap-1">
                <Clock class="w-3 h-3" />
                时长：{{ formatDuration(l.practiceTimeSeconds) }}
              </span>
            </div>
          </div>

          <span
            :class="[
              'px-2 py-0.5 rounded text-[11px] font-semibold shrink-0',
              l.id === practiceStore.currentLesson?.id
                ? 'bg-indigo-600 text-white'
                : 'bg-[#20263b] text-slate-400'
            ]"
          >
            {{ l.id === practiceStore.currentLesson?.id ? '当前在练' : '切换练习' }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
