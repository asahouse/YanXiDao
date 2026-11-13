<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useReviewStore } from '../stores/reviewStore'
import { ttsService } from '../services/ttsService'
import {
  Volume2,
  CheckCircle,
  Trash2,
  Play,
  Search,
  Check,
} from 'lucide-vue-next'

const router = useRouter()
const reviewStore = useReviewStore()

const toastMsg = ref('')
const showDeleteConfirmModal = ref(false)

onMounted(async () => {
  await reviewStore.fetchReviews()
})

function playTTS(sentenceEn: string) {
  ttsService.speak({ text: sentenceEn })
}

function handleMarkLearned(id: string) {
  reviewStore.markAsLearned(id)
  toastMsg.value = '太棒了！已标记为已学会'
  setTimeout(() => {
    toastMsg.value = ''
  }, 2000)
}

function handleDeleteOne(id: string) {
  reviewStore.deleteReview(id)
  toastMsg.value = '已从复习本移除'
  setTimeout(() => {
    toastMsg.value = ''
  }, 2000)
}

function handleDeleteBatch() {
  if (reviewStore.selectedIds.length === 0) return
  showDeleteConfirmModal.value = true
}

function confirmDelete() {
  reviewStore.deleteSelected()
  showDeleteConfirmModal.value = false
  toastMsg.value = '已成功删除所选项'
  setTimeout(() => {
    toastMsg.value = ''
  }, 2000)
}

function startReviewPractice() {
  if (reviewStore.filteredItems.length === 0) {
    toastMsg.value = '目前复习本暂无题目可供练习'
    setTimeout(() => { toastMsg.value = '' }, 2000)
    return
  }
  // Enters practice mode with the review items
  router.push('/practice/c_700/lesson_700_1')
}
</script>

<template>
  <div class="p-8 space-y-5 max-w-7xl mx-auto select-none">
    <!-- Top Tabs (5.png) -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <button
          @click="reviewStore.activeTab = 'unfamiliar'"
          :class="[
            'px-4 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer',
            reviewStore.activeTab === 'unfamiliar'
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
              : 'bg-[#151928] text-slate-400 hover:text-slate-200'
          ]"
        >
          不熟悉 ({{ reviewStore.unfamiliarCount }})
        </button>
        <button
          @click="reviewStore.activeTab = 'error'"
          :class="[
            'px-4 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer',
            reviewStore.activeTab === 'error'
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
              : 'bg-[#151928] text-slate-400 hover:text-slate-200'
          ]"
        >
          错题记录 ({{ reviewStore.errorCount }})
        </button>
      </div>

      <div class="text-xs text-slate-500 font-medium">当前用户: 8723192</div>
    </div>

    <!-- Actions & Filter Bar (5.png / 5-1.png) -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
      <div class="flex items-center gap-3">
        <!-- Search -->
        <div class="relative w-56">
          <Search class="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            v-model="reviewStore.searchQuery"
            type="text"
            :placeholder="reviewStore.activeTab === 'unfamiliar' ? '搜索不熟悉内容' : '搜索错题与复习记录'"
            class="w-full pl-9 pr-3 py-1.5 rounded-xl bg-[#141826] border border-[#22283e] text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-indigo-500"
          />
        </div>

        <!-- Delete buttons -->
        <button
          v-if="reviewStore.isBatchMode"
          @click="handleDeleteBatch"
          :disabled="reviewStore.selectedIds.length === 0"
          :class="[
            'px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer',
            reviewStore.selectedIds.length > 0
              ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-md shadow-rose-600/30'
              : 'bg-rose-950/40 text-rose-300/40 border border-rose-900/30 cursor-not-allowed'
          ]"
        >
          <Trash2 class="w-3.5 h-3.5" />
          <span>删除所选</span>
        </button>

        <!-- Batch toggle switch -->
        <label class="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            v-model="reviewStore.isBatchMode"
            class="w-4 h-4 accent-indigo-600 rounded"
          />
          <span>批量选择</span>
        </label>

        <!-- Select all when batch mode is active -->
        <button
          v-if="reviewStore.isBatchMode"
          @click="reviewStore.selectAll()"
          class="text-xs text-indigo-400 hover:text-indigo-300 font-medium cursor-pointer"
        >
          {{ reviewStore.selectedIds.length === reviewStore.filteredItems.length ? '取消全选' : '全选' }}
        </button>
      </div>

      <!-- Start Practice Button -->
      <button
        @click="startReviewPractice"
        class="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center gap-2 shadow-lg shadow-indigo-600/30 transition-all cursor-pointer"
      >
        <Play class="w-3.5 h-3.5 fill-white" />
        <span>开始练习</span>
      </button>
    </div>

    <!-- Toast Notification -->
    <div v-if="toastMsg" class="px-4 py-2 rounded-xl bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 text-xs flex items-center gap-2 animate-fade-in">
      <Check class="w-4 h-4 text-indigo-400" />
      <span>{{ toastMsg }}</span>
    </div>

    <!-- Empty State -->
    <div
      v-if="reviewStore.filteredItems.length === 0"
      class="py-24 text-center space-y-3"
    >
      <div class="w-16 h-16 mx-auto rounded-full bg-[#181d2f] flex items-center justify-center text-slate-500">
        <CheckCircle class="w-8 h-8 text-emerald-500/50" />
      </div>
      <div class="text-sm font-medium text-slate-400">
        {{ reviewStore.activeTab === 'unfamiliar' ? '目前没有需要复习的不熟悉题目' : '目前没有复习本记录' }}
      </div>
      <div class="text-xs text-slate-600">
        {{ reviewStore.activeTab === 'unfamiliar' ? '在练习中遇到不熟悉（按 Ctrl+Q）的题目会自动归入此处，点击“学会了”将移出本列表' : '练习错题与不熟悉收录将在此汇总展示（不分状态显示当前用户的所有复习记录）' }}
      </div>
    </div>

    <!-- List of Items (5.png / 5-1.png) -->
    <div v-else class="space-y-3">
      <div
        v-for="item in reviewStore.filteredItems"
        :key="item.id"
        class="p-4 rounded-2xl bg-[#141826] border border-[#22283e] hover:border-[#2f3856] flex items-center justify-between transition-colors group"
      >
        <!-- Left details -->
        <div class="flex items-center gap-4">
          <!-- Checkbox in batch mode -->
          <input
            v-if="reviewStore.isBatchMode"
            type="checkbox"
            :checked="reviewStore.selectedIds.includes(item.id)"
            @change="reviewStore.toggleSelect(item.id)"
            class="w-4 h-4 accent-indigo-600 rounded cursor-pointer"
          />

          <!-- TTS button -->
          <button
            @click="playTTS(item.sentenceEn)"
            class="p-2.5 rounded-xl bg-[#1e2338] hover:bg-indigo-600 text-slate-300 hover:text-white transition-colors cursor-pointer"
            title="TTS发音"
          >
            <Volume2 class="w-4 h-4" />
          </button>

          <div>
            <div class="text-sm font-bold text-slate-100 flex items-center gap-2.5 flex-wrap">
              <span>{{ item.sentenceEn }}</span>
              <span v-if="item.phonetic" class="text-xs text-slate-500 font-normal font-mono">/{{ item.phonetic }}/</span>
              
              <!-- Source Badge -->
              <span
                v-if="item.source === 'error'"
                class="px-2 py-0.5 rounded-md bg-rose-500/10 border border-rose-500/20 text-rose-400 text-[10px] font-semibold"
              >
                练习错题 <span v-if="item.errorCount">({{ item.errorCount }}次)</span>
              </span>
              <span
                v-else
                class="px-2 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-semibold"
              >
                不熟悉收录
              </span>

              <!-- Status Badge -->
              <span
                v-if="item.isLearned"
                class="px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-medium flex items-center gap-1"
              >
                <Check class="w-2.5 h-2.5" />
                已学会
              </span>
              <span
                v-else
                class="px-2 py-0.5 rounded-md bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-[10px] font-medium"
              >
                复习中
              </span>
            </div>
            <div class="text-xs text-slate-400 mt-1">
              {{ item.sentenceCn }}
            </div>
          </div>
        </div>

        <!-- Right actions & course info -->
        <div class="flex items-center gap-4">
          <div class="text-right text-[11px] text-slate-500">
            <div>{{ item.courseTitle }}</div>
            <div class="mt-0.5">{{ item.createdAt }}</div>
          </div>

          <!-- 学会了 / 已掌握 (Mark learned) -->
          <button
            v-if="!item.isLearned"
            @click="handleMarkLearned(item.id)"
            class="px-3.5 py-1.5 rounded-xl bg-[#1b2135] hover:bg-emerald-600/20 hover:text-emerald-400 hover:border-emerald-500/40 border border-[#27304d] text-xs font-semibold text-indigo-300 flex items-center gap-1.5 transition-all cursor-pointer"
          >
            <CheckCircle class="w-3.5 h-3.5" />
            <span>学会了</span>
          </button>
          <div
            v-else
            class="px-3 py-1.5 rounded-xl bg-emerald-950/20 border border-emerald-800/30 text-emerald-400 text-xs font-semibold flex items-center gap-1.5"
          >
            <Check class="w-3.5 h-3.5" />
            <span>已学会</span>
          </div>

          <!-- Delete single item -->
          <button
            @click="handleDeleteOne(item.id)"
            class="p-2 rounded-xl text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
            title="从复习本移除"
          >
            <Trash2 class="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>

    <!-- Bottom Pagination (5.png) -->
    <div class="flex items-center justify-between text-xs text-slate-500 pt-4 border-t border-[#1e2336]/60">
      <div>共 {{ reviewStore.filteredItems.length }} 条 · 当前 1-{{ reviewStore.filteredItems.length }} · 第 1/1 页</div>
      <div class="flex items-center gap-2">
        <button class="px-3 py-1 rounded-lg bg-[#141826] border border-[#22283e] text-slate-400 hover:text-white cursor-pointer">
          上一页
        </button>
        <button class="px-3 py-1 rounded-lg bg-[#141826] border border-[#22283e] text-slate-400 hover:text-white cursor-pointer">
          下一页
        </button>
      </div>
    </div>

    <!-- Secondary Confirmation Dialog for Deleting Selected Items -->
    <div
      v-if="showDeleteConfirmModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
    >
      <div class="w-full max-w-sm bg-[#181c2b] border border-[#272d45] rounded-2xl p-6 shadow-2xl text-center space-y-4">
        <h3 class="text-base font-bold text-white">确定要删除选中的 {{ reviewStore.selectedIds.length }} 项吗？</h3>
        <p class="text-xs text-slate-400">删除后将从当前复习本移除。</p>
        <div class="flex items-center gap-3 pt-2">
          <button
            @click="showDeleteConfirmModal = false"
            class="flex-1 py-2 rounded-xl bg-[#252b41] hover:bg-[#303754] text-xs font-semibold text-slate-300"
          >
            取消
          </button>
          <button
            @click="confirmDelete"
            class="flex-1 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white"
          >
            确认删除
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
