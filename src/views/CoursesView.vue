<script setup lang="ts">
import { userFetch } from '../utils/userApi'
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useCourseStore } from '../stores/courseStore'
import type { CourseCategory } from '../types'
import { Search, ListChecks, Star, Check, Upload } from 'lucide-vue-next'

const router = useRouter()
const courseStore = useCourseStore()

const activeCategory = ref<CourseCategory>('all')
const searchInput = ref('')
const appliedSearch = ref('')
const toastMsg = ref('')
const progressMap = ref<Record<string, any>>({})
const packInputRef = ref<HTMLInputElement | null>(null)
const isImportingPack = ref(false)

async function handleQuickImportPack(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    isImportingPack.value = true
    const text = await file.text()
    const bundle = JSON.parse(text)
    const res = await userFetch('/api/sync/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bundle }),
    })
    const data = await res.json()
    if (!res.ok || !data.success) {
      throw new Error(data.error || '导入课程包失败')
    }
    await courseStore.fetchCourses()
    await fetchCategories()
    toastMsg.value = `题库更新成功！已合并 ${data.imported.courses} 门课程、${data.imported.lessons} 节课时`
    setTimeout(() => { toastMsg.value = '' }, 4000)
  } catch (err: any) {
    toastMsg.value = `导入失败：${err.message}`
    setTimeout(() => { toastMsg.value = '' }, 4000)
  } finally {
    isImportingPack.value = false
    if (packInputRef.value) packInputRef.value.value = ''
  }
}

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

async function handleToggleFavorite(courseId: string) {
  const isFav = await courseStore.toggleFavorite(courseId)
  toastMsg.value = isFav ? '已添加到我的收藏' : '已从我的收藏移除'
  setTimeout(() => { toastMsg.value = '' }, 2000)
}

const categories = ref<{ label: string; value: string }[]>([
  { label: '全部', value: 'all' },
  { label: '零基础', value: 'zero' },
  { label: '入门', value: 'intro' },
  { label: '初级', value: 'elementary' },
  { label: '中级', value: 'intermediate' },
  { label: '进阶', value: 'advanced' },
  { label: '高级', value: 'master' },
])

async function fetchCategories() {
  try {
    const res = await userFetch('/api/categories/courses')
    if (res.ok) {
      const data: any[] = await res.json()
      const enabled = data.filter(c => c.isEnabled)
      if (enabled.length > 0) {
        categories.value = [
          { label: '全部', value: 'all' },
          ...enabled.map(c => ({ label: c.name, value: c.catKey }))
        ]
      }
    }
  } catch (err) {
    console.error('Failed to fetch categories:', err)
  }
}

function handleSearch() {
  appliedSearch.value = searchInput.value.trim()
}

function handleClearSearch() {
  searchInput.value = ''
  appliedSearch.value = ''
}

const filteredCourses = computed(() => {
  return courseStore.courses.filter((course) => {
    const matchesCategory = activeCategory.value === 'all' || course.category === activeCategory.value
    const matchesSearch =
      !appliedSearch.value ||
      course.title.toLowerCase().includes(appliedSearch.value.toLowerCase()) ||
      course.instructor.name.toLowerCase().includes(appliedSearch.value.toLowerCase())
    return matchesCategory && matchesSearch
  })
})

function goToCourse(courseId: string) {
  router.push(`/course/${courseId}`)
}
</script>

<template>
  <div class="p-8 space-y-6 max-w-7xl mx-auto select-none">
    <!-- Top Filter & Search Bar -->
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
      <!-- Category Tabs (No clipping, smooth ambient shadow transition) -->
      <div class="flex items-center gap-2 flex-wrap py-1.5">
        <button
          v-for="cat in categories"
          :key="cat.value"
          @click="activeCategory = cat.value"
          :class="[
            'category-pill-btn px-4 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap cursor-pointer',
            activeCategory === cat.value
              ? 'is-active bg-indigo-600 text-white'
              : 'bg-[#151928] text-slate-400 hover:text-slate-200 hover:bg-[#1e2338]'
          ]"
        >
          {{ cat.label }}
        </button>
      </div>

      <!-- Search Input & Offline Bundle Import -->
      <div class="flex items-center gap-2.5 w-full md:w-auto shrink-0">
        <input
          ref="packInputRef"
          type="file"
          accept=".yxdpack,.json,application/json"
          class="hidden"
          @change="handleQuickImportPack"
        />
        <button
          @click="packInputRef?.click()"
          :disabled="isImportingPack"
          class="px-3.5 py-2 rounded-xl bg-[#151928] hover:bg-[#1e2338] border border-[#242b42] hover:border-indigo-500/40 text-xs font-medium text-slate-300 hover:text-white flex items-center gap-1.5 shrink-0 cursor-pointer transition-all"
          title="导入离线课程更新包 (.yxdpack / .json)，保留个人学习进度"
        >
          <Upload class="w-3.5 h-3.5 text-indigo-400" />
          <span>{{ isImportingPack ? '更新中...' : '导入课程包' }}</span>
        </button>

        <div class="relative flex-1 md:w-64">
          <button
            @click="handleSearch"
            class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-indigo-400 transition-colors cursor-pointer"
            title="点击搜索或按 Enter"
          >
            <Search class="w-4 h-4" />
          </button>
          <input
            v-model="searchInput"
            @keydown.enter="handleSearch"
            type="text"
            placeholder="搜索课程/讲师（按 Enter 搜索）"
            class="w-full pl-9 pr-8 py-2 rounded-xl bg-[#151928] border border-[#242b42] text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-indigo-500 transition-colors"
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
        <span class="text-slate-400">（共找到 {{ filteredCourses.length }} 门课程）</span>
      </div>
      <button
        @click="handleClearSearch"
        class="text-indigo-400 hover:text-indigo-300 text-xs font-semibold cursor-pointer underline underline-offset-2"
      >
        清除搜索
      </button>
    </div>

    <!-- Empty State -->
    <div
      v-if="filteredCourses.length === 0"
      class="py-24 text-center space-y-3"
    >
      <div class="w-16 h-16 mx-auto rounded-full bg-[#181d2f] flex items-center justify-center text-slate-500">
        <Search class="w-8 h-8" />
      </div>
      <div class="text-sm font-medium text-slate-400">当前分类下未找到相关课程</div>
      <div class="text-xs text-slate-600">
        {{ appliedSearch ? `在当前分类中未匹配到 “${appliedSearch}”，尝试切换分类或修改搜索词后按 Enter 搜索` : '当前分类暂无课程，尝试选择其他分类' }}
      </div>
    </div>

    <!-- Course Grid -->
    <div v-else class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-5">
      <div
        v-for="course in filteredCourses"
        :key="course.id"
        @click="goToCourse(course.id)"
        class="group flex flex-col rounded-2xl bg-[#141826] border border-[#22283e] overflow-hidden hover:border-indigo-500/50 hover:shadow-xl hover:shadow-indigo-950/40 hover:-translate-y-1 transition-all duration-300 cursor-pointer relative"
      >
        <!-- Cover Image -->
        <div class="relative aspect-[3/4] w-full overflow-hidden bg-slate-800">
          <img
            :src="course.cover"
            :alt="course.title"
            class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
          <div class="absolute inset-0 bg-gradient-to-t from-[#0e111a] via-transparent to-transparent opacity-80"></div>

          <!-- Progress Badge -->
          <div
            v-if="progressMap[course.id]"
            class="absolute top-2.5 left-2.5 px-2 py-0.5 rounded-lg bg-indigo-600/85 backdrop-blur-md text-white text-[10px] font-bold z-10 shadow"
          >
            已学 {{ progressMap[course.id].progressPercent }}%
          </div>

          <!-- Favorite Star Button -->
          <button
            @click.stop="handleToggleFavorite(course.id)"
            class="card-star-btn absolute top-2.5 right-2.5 p-1.5 rounded-xl bg-black/50 backdrop-blur-md border border-white/10 hover:bg-black/75 transition-all cursor-pointer z-10 group/star"
            :title="course.isFavorite ? '取消收藏' : '收藏课程'"
          >
            <Star
              :class="[
                'w-3.5 h-3.5 transition-colors',
                course.isFavorite ? 'fill-amber-400 text-amber-400' : 'text-white/60 group-hover/star:text-white'
              ]"
            />
          </button>
        </div>

        <!-- Info Area -->
        <div class="p-3.5 flex flex-col justify-between flex-1">
          <div class="text-xs font-bold text-slate-100 line-clamp-2 leading-snug group-hover:text-indigo-300 transition-colors">
            {{ course.title }}
          </div>

          <div class="flex items-center justify-between mt-3 text-[11px] text-slate-400">
            <div class="flex items-center gap-1.5">
              <span class="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
              <span>{{ course.instructor.name }}</span>
            </div>
            <div class="flex items-center gap-1">
              <ListChecks class="w-3 h-3 text-slate-400" />
              <span>{{ course.lessonCount }}小节</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
