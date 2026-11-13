<script setup lang="ts">
import { userFetch } from '../utils/userApi'
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useCourseStore } from '../stores/courseStore'
import type { SchoolLevel } from '../types'
import { Search, ListChecks, Star, Check } from 'lucide-vue-next'

const router = useRouter()
const courseStore = useCourseStore()

const activeLevel = ref<SchoolLevel>('primary')
const activeGrade = ref<number | 'all'>('all')
const searchInput = ref('')
const appliedSearch = ref('')
const toastMsg = ref('')
const progressMap = ref<Record<string, any>>({})

async function fetchProgressMap() {
  try {
    const res = await userFetch('/api/user/progress/all?userId=8723192')
    if (res.ok) {
      progressMap.value = await res.json()
    }
  } catch {}
}

onMounted(() => {
  fetchProgressMap()
  fetchCategories()
})

async function handleToggleFavorite(materialId: string) {
  const isFav = await courseStore.toggleFavorite(materialId)
  toastMsg.value = isFav ? '已添加到我的收藏' : '已从我的收藏移除'
  setTimeout(() => { toastMsg.value = '' }, 2000)
}

const rawSchoolLevels = ref<any[]>([])
const schoolLevels = ref<{ label: string; value: string }[]>([
  { label: '全部', value: 'all' },
  { label: '小学', value: 'primary' },
  { label: '初中', value: 'junior' },
  { label: '高中', value: 'senior' },
  { label: '大学', value: 'college' },
])

async function fetchCategories() {
  try {
    const res = await userFetch('/api/categories/teaching')
    if (res.ok) {
      const data: any[] = await res.json()
      rawSchoolLevels.value = data
      const enabled = data.filter(l => l.isEnabled)
      if (enabled.length > 0) {
        schoolLevels.value = [
          { label: '全部', value: 'all' },
          ...enabled.map(l => ({ label: l.name, value: l.levelKey }))
        ]
      }
    }
  } catch (err) {
    console.error('Failed to load teaching categories:', err)
  }
}

// Compute active grades for currently selected school level
const currentGrades = computed(() => {
  if (activeLevel.value === 'all') {
    const list: { label: string; value: number | 'all' }[] = [{ label: '全部', value: 'all' }]
    const seen = new Set<number>()
    rawSchoolLevels.value.forEach(l => {
      l.grades?.filter((g: any) => g.isEnabled).forEach((g: any) => {
        if (!seen.has(g.gradeValue)) {
          seen.add(g.gradeValue)
          list.push({ label: g.name, value: g.gradeValue })
        }
      })
    })
    return list
  }
  const found = rawSchoolLevels.value.find(l => l.levelKey === activeLevel.value)
  if (!found || !found.grades) {
    return [{ label: '全部', value: 'all' }]
  }
  return [
    { label: '全部', value: 'all' },
    ...found.grades.filter((g: any) => g.isEnabled).map((g: any) => ({ label: g.name, value: g.gradeValue }))
  ]
})

function handleSearch() {
  appliedSearch.value = searchInput.value.trim()
}

function handleClearSearch() {
  searchInput.value = ''
  appliedSearch.value = ''
}

const filteredMaterials = computed(() => {
  return courseStore.teachingMaterials.filter((item) => {
    const matchesLevel = activeLevel.value === 'all' || item.schoolLevel === activeLevel.value
    const matchesGrade = activeGrade.value === 'all' || item.grade === activeGrade.value
    const matchesSearch =
      !appliedSearch.value ||
      item.title.toLowerCase().includes(appliedSearch.value.toLowerCase()) ||
      item.instructor.name.toLowerCase().includes(appliedSearch.value.toLowerCase())
    return matchesLevel && matchesGrade && matchesSearch
  })
})

function goToDetail(id: string) {
  router.push(`/course/${id}`)
}
</script>

<template>
  <div class="p-8 space-y-5 max-w-7xl mx-auto select-none">
    <!-- Level 1 Filter -->
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div class="flex items-center gap-2 flex-wrap py-1">
        <button
          v-for="lvl in schoolLevels"
          :key="lvl.value"
          @click="activeLevel = lvl.value; activeGrade = 'all'"
          :class="[
            'category-pill-btn px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer',
            activeLevel === lvl.value
              ? 'is-active bg-indigo-600 text-white'
              : 'bg-[#151928] text-slate-400 hover:text-slate-200 hover:bg-[#1e2338]'
          ]"
        >
          {{ lvl.label }}
        </button>
      </div>

      <!-- Search Input (Enter to search) -->
      <div class="relative w-full md:w-72 shrink-0">
        <button
          @click="handleSearch"
          class="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-indigo-400 transition-colors cursor-pointer"
          title="点击搜索或按 Enter"
        >
          <Search class="w-4 h-4" />
        </button>
        <input
          v-model="searchInput"
          @keydown.enter="handleSearch"
          type="text"
          placeholder="搜索教辅/课程（按 Enter 搜索）"
          class="w-full pl-10 pr-8 py-2 rounded-xl bg-[#151928] border border-[#242b42] text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-indigo-500 transition-colors"
        />
        <button
          v-if="searchInput"
          @click="handleClearSearch"
          class="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs cursor-pointer p-0.5"
          title="清空"
        >
          ✕
        </button>
      </div>
    </div>

    <!-- Toast Notification -->
    <div v-if="toastMsg" class="px-4 py-2 rounded-xl bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 text-xs flex items-center gap-2 animate-fade-in w-fit">
      <Check class="w-4 h-4 text-indigo-400" />
      <span>{{ toastMsg }}</span>
    </div>

    <!-- Active Search Filter Badge -->
    <div v-if="appliedSearch" class="flex items-center justify-between p-3 rounded-xl bg-indigo-950/30 border border-indigo-500/20 text-xs">
      <div class="flex items-center gap-2 text-slate-300">
        <span>当前类型下的搜索结果：</span>
        <span class="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-semibold">“{{ appliedSearch }}”</span>
        <span class="text-slate-400">（共找到 {{ filteredMaterials.length }} 本教辅）</span>
      </div>
      <button
        @click="handleClearSearch"
        class="text-indigo-400 hover:text-indigo-300 text-xs font-semibold cursor-pointer underline underline-offset-2"
      >
        清除搜索
      </button>
    </div>

    <!-- Level 2 Filter (Dynamic Grades for Selected School Level) -->
    <div v-if="currentGrades.length > 1" class="flex items-center gap-2 pt-2 border-t border-[#1e2438]/50 flex-wrap">
      <span class="text-xs font-medium text-slate-500 mr-2">年级</span>
      <button
        v-for="g in currentGrades"
        :key="String(g.value)"
        @click="activeGrade = g.value"
        :class="[
          'grade-pill-btn px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer',
          activeGrade === g.value
            ? 'is-active bg-[#22283e] text-indigo-400 border border-indigo-500/40'
            : 'text-slate-400 hover:text-slate-200'
        ]"
      >
        {{ g.label }}
      </button>
    </div>

    <!-- Empty State -->
    <div
      v-if="filteredMaterials.length === 0"
      class="py-24 text-center space-y-3"
    >
      <div class="w-16 h-16 mx-auto rounded-full bg-[#181d2f] flex items-center justify-center text-slate-500">
        <Search class="w-8 h-8" />
      </div>
      <div class="text-sm font-medium text-slate-400">当前学段/年级下未找到相关教辅</div>
      <div class="text-xs text-slate-600">
        {{ appliedSearch ? `在当前类型中未匹配到 “${appliedSearch}”，尝试切换学段或修改搜索词后按 Enter 搜索` : '当前学段/年级暂无教辅，尝试选择其他分类' }}
      </div>
    </div>

    <!-- Material Grid -->
    <div v-else class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-5 pt-2">
      <div
        v-for="material in filteredMaterials"
        :key="material.id"
        @click="goToDetail(material.id)"
        class="group flex flex-col rounded-2xl bg-[#141826] border border-[#22283e] overflow-hidden hover:border-indigo-500/50 hover:shadow-xl hover:shadow-indigo-950/40 hover:-translate-y-1 transition-all duration-300 cursor-pointer relative"
      >
        <!-- Cover -->
        <div class="relative aspect-[3/4] w-full overflow-hidden bg-slate-900 border-b border-white/5">
          <img
            :src="material.cover"
            :alt="material.title"
            class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
          <!-- Subtle Book Spine Shadow & Vignette -->
          <div class="absolute inset-y-0 left-0 w-3 bg-gradient-to-r from-black/30 to-transparent pointer-events-none"></div>
          <div class="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-black/15 pointer-events-none opacity-60 group-hover:opacity-20 transition-opacity"></div>

          <!-- Progress Badge -->
          <div
            v-if="progressMap[material.id]"
            class="absolute top-2.5 left-2.5 px-2 py-0.5 rounded-lg bg-indigo-600/85 backdrop-blur-md text-white text-[10px] font-bold z-10 shadow"
          >
            已学 {{ progressMap[material.id].progressPercent }}%
          </div>

          <!-- Favorite Star Button -->
          <button
            @click.stop="handleToggleFavorite(material.id)"
            class="card-star-btn absolute top-2.5 right-2.5 p-1.5 rounded-xl bg-black/50 backdrop-blur-md border border-white/10 hover:bg-black/75 transition-all cursor-pointer z-10 group/star"
            :title="material.isFavorite ? '取消收藏' : '收藏教辅'"
          >
            <Star
              :class="[
                'w-3.5 h-3.5 transition-colors',
                material.isFavorite ? 'fill-amber-400 text-amber-400' : 'text-white/60 group-hover/star:text-white'
              ]"
            />
          </button>
        </div>

        <!-- Info -->
        <div class="p-3.5 flex flex-col justify-between flex-1">
          <div class="text-xs font-bold text-slate-100 line-clamp-2 leading-snug group-hover:text-indigo-300 transition-colors">
            {{ material.title }}
          </div>

          <div class="flex items-center justify-between mt-3 text-[11px] text-slate-400">
            <div class="flex items-center gap-1.5">
              <span class="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
              <span>{{ material.instructor.name }}</span>
            </div>
            <div class="flex items-center gap-1">
              <ListChecks class="w-3 h-3 text-slate-400" />
              <span>{{ material.lessonCount }}小节</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
