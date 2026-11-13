<script setup lang="ts">
import { userFetch } from '../utils/userApi'
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useCourseStore } from '../stores/courseStore'
import { ttsService } from '../services/ttsService'
import { Volume2, Star, ListChecks, Check, ArrowRight } from 'lucide-vue-next'

const router = useRouter()
const courseStore = useCourseStore()

const activeTab = ref<'courses' | 'sentences'>('courses')
const toastMsg = ref('')

onMounted(async () => {
  await Promise.allSettled([
    courseStore.fetchCourses(),
    fetchFavoriteSentences(),
  ])
})

const favoriteCourses = computed(() => {
  return [
    ...courseStore.courses.filter((c) => c.isFavorite),
    ...courseStore.teachingMaterials.filter((m) => m.isFavorite),
  ]
})

// Sentences in favorites from DB
const favoriteSentences = ref<{ id: string; sentenceEn: string; sentenceCn: string; phonetic?: string; courseTitle: string }[]>([])

async function fetchFavoriteSentences() {
  try {
    const res = await userFetch('/api/favorites/sentences?userId=8723192')
    if (res.ok) {
      favoriteSentences.value = await res.json()
    }
  } catch (err) {
    console.error('Failed to fetch favorite sentences:', err)
  }
}

function playTTS(text: string) {
  ttsService.speak({ text })
}

function goToCourse(id: string) {
  router.push(`/course/${id}`)
}

async function handleRemoveFavorite(courseId: string) {
  await courseStore.toggleFavorite(courseId)
  toastMsg.value = '已从我的收藏移除'
  setTimeout(() => { toastMsg.value = '' }, 2000)
}

async function handleRemoveSentence(id: string) {
  favoriteSentences.value = favoriteSentences.value.filter(s => s.id !== id)
  try {
    await userFetch(`/api/favorites/sentences/${id}`, { method: 'DELETE' })
  } catch (err) {
    console.error('Failed to delete favorite sentence:', err)
  }
  toastMsg.value = '已从句子收藏移除'
  setTimeout(() => { toastMsg.value = '' }, 2000)
}
</script>

<template>
  <div class="p-8 space-y-6 max-w-7xl mx-auto select-none">
    <!-- Top Tabs -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <button
          @click="activeTab = 'courses'"
          :class="[
            'px-4 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer',
            activeTab === 'courses'
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
              : 'bg-[#151928] text-slate-400 hover:text-slate-200'
          ]"
        >
          已收藏课程与教辅 ({{ favoriteCourses.length }})
        </button>
        <button
          @click="activeTab = 'sentences'"
          :class="[
            'px-4 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer',
            activeTab === 'sentences'
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
              : 'bg-[#151928] text-slate-400 hover:text-slate-200'
          ]"
        >
          已收藏句子 ({{ favoriteSentences.length }})
        </button>
      </div>

      <div class="text-xs text-slate-500 font-medium">当前用户: 8723192</div>
    </div>

    <!-- Toast Notification -->
    <div v-if="toastMsg" class="px-4 py-2 rounded-xl bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 text-xs flex items-center gap-2 animate-fade-in w-fit">
      <Check class="w-4 h-4 text-indigo-400" />
      <span>{{ toastMsg }}</span>
    </div>

    <!-- Tab 1: Favorite Courses & Materials -->
    <div v-if="activeTab === 'courses'">
      <div v-if="favoriteCourses.length === 0" class="py-24 text-center space-y-3">
        <div class="w-16 h-16 mx-auto rounded-full bg-[#181d2f] flex items-center justify-center text-slate-500">
          <Star class="w-8 h-8 text-amber-500/40" />
        </div>
        <div class="text-sm font-medium text-slate-400">暂无收藏课程与教辅</div>
        <div class="text-xs text-slate-600">
          可以在课程广场或同步教辅中，点击封面右上角的星标即可收藏；收藏内容在此按当前用户实时同步
        </div>
        <div class="pt-2 flex items-center justify-center gap-3">
          <router-link
            to="/courses"
            class="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1 transition-all"
          >
            <span>探索课程广场</span>
            <ArrowRight class="w-3.5 h-3.5" />
          </router-link>
          <router-link
            to="/teaching"
            class="px-4 py-1.5 rounded-xl bg-[#1c2237] hover:bg-[#262e49] border border-[#272e47] text-slate-300 text-xs font-semibold flex items-center gap-1 transition-all"
          >
            <span>探索同步教辅</span>
            <ArrowRight class="w-3.5 h-3.5" />
          </router-link>
        </div>
      </div>
      <div v-else class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-5">
        <div
          v-for="course in favoriteCourses"
          :key="course.id"
          @click="goToCourse(course.id)"
          class="group flex flex-col rounded-2xl bg-[#141826] border border-[#22283e] overflow-hidden hover:border-indigo-500/50 hover:shadow-xl hover:shadow-indigo-950/40 hover:-translate-y-1 transition-all duration-300 cursor-pointer relative"
        >
          <!-- Cover -->
          <div class="relative aspect-[3/4] w-full overflow-hidden bg-slate-800">
            <img :src="course.cover" :alt="course.title" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
            <div class="absolute inset-0 bg-gradient-to-t from-[#0e111a] via-transparent to-transparent opacity-80"></div>
            
            <!-- Type Tag -->
            <div class="card-type-tag absolute top-2.5 left-2.5 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-md border border-white/10 text-[10px] font-semibold text-slate-300">
              {{ course.type === 'teaching' ? '同步教辅' : '精品课程' }}
            </div>

            <!-- Remove from Favorite Button -->
            <button
              @click.stop="handleRemoveFavorite(course.id)"
              class="card-star-btn absolute top-2.5 right-2.5 p-1.5 rounded-xl bg-black/60 backdrop-blur-md border border-white/10 hover:bg-rose-950/80 hover:border-rose-500/40 text-amber-400 hover:text-rose-300 transition-all cursor-pointer z-10"
              title="取消收藏"
            >
              <Star class="w-3.5 h-3.5 fill-amber-400" />
            </button>
          </div>

          <div class="p-3.5 flex flex-col justify-between flex-1">
            <div class="text-xs font-bold text-slate-100 line-clamp-2 group-hover:text-indigo-300 transition-colors">
              {{ course.title }}
            </div>
            <div class="flex items-center justify-between mt-3 text-[11px] text-slate-400">
              <div class="flex items-center gap-1.5">
                <span class="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
                <span>{{ course.instructor.name }}</span>
              </div>
              <div class="flex items-center gap-1">
                <ListChecks class="w-3 h-3" />
                <span>{{ course.lessonCount }}小节</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Tab 2: Favorite Sentences -->
    <div v-else class="space-y-3">
      <div v-if="favoriteSentences.length === 0" class="py-24 text-center space-y-3">
        <div class="w-16 h-16 mx-auto rounded-full bg-[#181d2f] flex items-center justify-center text-slate-500">
          <Star class="w-8 h-8 text-amber-500/40" />
        </div>
        <div class="text-sm font-medium text-slate-400">暂无收藏句子</div>
        <div class="text-xs text-slate-600">在学习或练习中收藏的精彩句型将在此集中呈现</div>
      </div>
      <div v-else class="space-y-3">
        <div
          v-for="s in favoriteSentences"
          :key="s.id"
          class="p-4 rounded-2xl bg-[#141826] border border-[#22283e] flex items-center justify-between group hover:border-[#2f3856] transition-colors"
        >
          <div class="flex items-center gap-4">
            <button
              @click="playTTS(s.sentenceEn)"
              class="p-2.5 rounded-xl bg-[#1e2338] hover:bg-indigo-600 text-slate-300 hover:text-white transition-colors cursor-pointer"
              title="TTS发音"
            >
              <Volume2 class="w-4 h-4" />
            </button>
            <div>
              <div class="text-sm font-bold text-slate-100 flex items-center gap-2">
                <span>{{ s.sentenceEn }}</span>
                <span v-if="s.phonetic" class="text-xs text-slate-500 font-normal font-mono">/{{ s.phonetic }}/</span>
              </div>
              <div class="text-xs text-slate-400 mt-1">{{ s.sentenceCn }}</div>
            </div>
          </div>
          <div class="flex items-center gap-3">
            <span class="text-xs text-slate-500">{{ s.courseTitle }}</span>
            <button
              @click="handleRemoveSentence(s.id)"
              class="p-1.5 text-amber-400 hover:text-rose-400 transition-colors cursor-pointer"
              title="取消收藏"
            >
              <Star class="w-4 h-4 fill-amber-400" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
