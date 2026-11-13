<script setup lang="ts">
import { ref } from 'vue'
import { usePracticeStore } from '../../stores/practiceStore'
import { X, AlertCircle } from 'lucide-vue-next'

const practiceStore = usePracticeStore()

const reportType = ref<'pronunciation' | 'answer' | 'display'>('pronunciation')
const description = ref('')

async function handleSubmit() {
  try {
    await fetch('/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reportType: reportType.value,
        description: description.value.trim(),
        sentenceEn: practiceStore.currentSentence?.sentenceEn || '',
        courseTitle: practiceStore.currentLesson?.titleEn || '',
        userId: '8723192',
      }),
    })
  } catch (err) {
    console.error('Failed to submit report:', err)
  }
  practiceStore.showReportModal = false
  practiceStore.showToast('报错工单已提交，感谢您的反馈！')
  description.value = ''
}
</script>

<template>
  <div
    v-if="practiceStore.showReportModal"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 select-none"
    @click.self="practiceStore.showReportModal = false"
  >
    <div class="w-full max-w-md bg-[#181c2b] border border-[#272d45] rounded-2xl shadow-2xl overflow-hidden flex flex-col">
      <div class="flex items-center justify-between px-6 py-4 border-b border-[#242b41]">
        <h3 class="text-sm font-bold text-white flex items-center gap-2">
          <AlertCircle class="w-4 h-4 text-amber-400" />
          <span>题目报错</span>
        </h3>
        <button
          @click="practiceStore.showReportModal = false"
          class="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-[#23293f] transition-colors"
        >
          <X class="w-5 h-5" />
        </button>
      </div>

      <div class="p-6 space-y-4 text-xs">
        <div>
          <label class="block text-slate-300 font-medium mb-2">报错类型</label>
          <div class="grid grid-cols-3 gap-2">
            <button
              type="button"
              @click="reportType = 'pronunciation'"
              :class="[
                'report-type-btn py-2 rounded-xl font-medium border transition-colors cursor-pointer',
                reportType === 'pronunciation'
                  ? 'is-active bg-indigo-600/20 border-indigo-500 text-indigo-300'
                  : 'is-inactive bg-[#151928] border-[#22283e] text-slate-400'
              ]"
            >
              发音问题
            </button>
            <button
              type="button"
              @click="reportType = 'answer'"
              :class="[
                'report-type-btn py-2 rounded-xl font-medium border transition-colors cursor-pointer',
                reportType === 'answer'
                  ? 'is-active bg-indigo-600/20 border-indigo-500 text-indigo-300'
                  : 'is-inactive bg-[#151928] border-[#22283e] text-slate-400'
              ]"
            >
              答案错误
            </button>
            <button
              type="button"
              @click="reportType = 'display'"
              :class="[
                'report-type-btn py-2 rounded-xl font-medium border transition-colors cursor-pointer',
                reportType === 'display'
                  ? 'is-active bg-indigo-600/20 border-indigo-500 text-indigo-300'
                  : 'is-inactive bg-[#151928] border-[#22283e] text-slate-400'
              ]"
            >
              显示错误
            </button>
          </div>
        </div>

        <div>
          <label class="block text-slate-300 font-medium mb-2">详细描述（选填）</label>
          <textarea
            v-model="description"
            rows="3"
            placeholder="请简要描述您遇到的问题..."
            class="w-full p-3 rounded-xl bg-[#141826] border border-[#22283e] text-slate-200 placeholder-slate-500 outline-none focus:border-indigo-500 resize-none"
          ></textarea>
        </div>

        <button
          @click="handleSubmit"
          class="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition-colors cursor-pointer"
        >
          提交报错
        </button>
      </div>
    </div>
  </div>
</template>
