import { userFetch } from '../utils/userApi'
import { defineStore } from 'pinia'
import type { ReviewItem, WordToken } from '../types'

export const useReviewStore = defineStore('review', {
  state: () => {
    let savedLearned: string[] = []
    try {
      savedLearned = JSON.parse(localStorage.getItem('tqd_learned_sentences') || '[]')
    } catch {
      savedLearned = []
    }

    return {
      items: [] as ReviewItem[], // 默认是空的复习本
      selectedIds: [] as string[],
      isBatchMode: false,
      activeTab: 'unfamiliar' as 'error' | 'unfamiliar', // 默认聚焦“不熟悉”
      searchQuery: '',
      isLoading: false,
      learnedSentences: savedLearned, // 已经点击“学会了”被屏蔽的句子
    }
  },
  getters: {
    filteredItems(state) {
      // 1. 如果在“不熟悉”选项卡：只显示未学会的不熟悉题目
      if (state.activeTab === 'unfamiliar') {
        return state.items
          .filter(item => item.source === 'unfamiliar' && !item.isLearned && !state.learnedSentences.includes(item.sentenceEn))
          .filter(item => {
            if (!state.searchQuery.trim()) return true
            const q = state.searchQuery.toLowerCase()
            return item.sentenceEn.toLowerCase().includes(q) || item.sentenceCn.includes(q)
          })
      }

      // 2. 如果在“错题记录”选项卡：
      // 核心需求：所有的复习本记录都需要显示到错题记录上，这个是不分状态显示所有复习本的数据，当然是当前用户的。
      return state.items
        .filter(item => {
          if (!state.searchQuery.trim()) return true
          const q = state.searchQuery.toLowerCase()
          return item.sentenceEn.toLowerCase().includes(q) || item.sentenceCn.includes(q)
        })
    },
    unfamiliarCount(state) {
      return state.items.filter(item => item.source === 'unfamiliar' && !item.isLearned && !state.learnedSentences.includes(item.sentenceEn)).length
    },
    errorCount(state) {
      // 错题记录显示当前用户所有复习本数据条数
      return state.items.length
    },
  },
  actions: {
    async fetchReviews() {
      try {
        this.isLoading = true
        const res = await userFetch('/api/reviews?userId=8723192')
        if (res.ok) {
          const data: ReviewItem[] = await res.json()
          // 载入当前用户的所有复习本数据，并保持学会/学习中状态
          this.items = data.map(i => ({
            ...i,
            isLearned: Boolean(i.isLearned) || this.learnedSentences.includes(i.sentenceEn),
          }))
        }
      } catch (err) {
        console.error('Failed to fetch reviews:', err)
      } finally {
        this.isLoading = false
      }
    },

    async addUnfamiliar(sentenceEn: string, sentenceCn: string, phonetic: string, words: WordToken[], courseTitle: string) {
      // 若该句子曾被标记为学会，重新加为不熟悉时解除屏蔽
      if (this.learnedSentences.includes(sentenceEn)) {
        this.learnedSentences = this.learnedSentences.filter(s => s !== sentenceEn)
        try {
          localStorage.setItem('tqd_learned_sentences', JSON.stringify(this.learnedSentences))
        } catch {
          // Ignored
        }
      }

      const existing = this.items.find(i => i.sentenceEn === sentenceEn && i.source === 'unfamiliar')
      if (existing) {
        existing.isLearned = false
        try {
          await userFetch(`/api/reviews/${existing.id}/learned`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isLearned: false }),
          })
        } catch {}
      } else {
        const newItem: ReviewItem = {
          id: `rev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          userId: '8723192',
          sentenceEn,
          sentenceCn,
          phonetic,
          words,
          courseTitle,
          createdAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
          source: 'unfamiliar',
          errorCount: 1,
          isLearned: false,
        }
        this.items.unshift(newItem)
        try {
          await userFetch('/api/reviews', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newItem),
          })
        } catch (err) {
          console.error('Failed to persist review:', err)
        }
      }
    },

    async addError(sentenceEn: string, sentenceCn: string, phonetic: string, words: WordToken[], courseTitle: string) {
      const existing = this.items.find(i => i.sentenceEn === sentenceEn && i.source === 'error')
      let itemToSave: ReviewItem
      if (existing) {
        existing.errorCount += 1
        itemToSave = existing
      } else {
        itemToSave = {
          id: `rev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          userId: '8723192',
          sentenceEn,
          sentenceCn,
          phonetic,
          words,
          courseTitle,
          createdAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
          source: 'error',
          errorCount: 1,
          isLearned: false,
        }
        this.items.unshift(itemToSave)
      }
      try {
        await userFetch('/api/reviews', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(itemToSave),
        })
      } catch (err) {
        console.error('Failed to persist review error:', err)
      }
    },

    async markAsLearned(id: string) {
      const target = this.items.find(i => i.id === id)
      if (target) {
        target.isLearned = true
        if (target.source === 'unfamiliar' && !this.learnedSentences.includes(target.sentenceEn)) {
          this.learnedSentences.push(target.sentenceEn)
          try {
            localStorage.setItem('tqd_learned_sentences', JSON.stringify(this.learnedSentences))
          } catch {}
        }
      }

      try {
        await userFetch(`/api/reviews/${id}/learned`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isLearned: true }),
        })
      } catch (err) {
        console.error('Failed to update review item status:', err)
      }
    },

    async deleteReview(id: string) {
      this.items = this.items.filter(i => i.id !== id)
      this.selectedIds = this.selectedIds.filter(sId => sId !== id)
      try {
        await userFetch(`/api/reviews/${id}`, { method: 'DELETE' })
      } catch (err) {
        console.error('Failed to delete review item:', err)
      }
    },

    async deleteSelected() {
      const idsToDelete = [...this.selectedIds]
      this.items = this.items.filter(i => !this.selectedIds.includes(i.id))
      this.selectedIds = []
      for (const id of idsToDelete) {
        try {
          await userFetch(`/api/reviews/${id}`, { method: 'DELETE' })
        } catch (err) {
          console.error('Failed to delete review item:', err)
        }
      }
    },

    toggleSelect(id: string) {
      if (this.selectedIds.includes(id)) {
        this.selectedIds = this.selectedIds.filter(sId => sId !== id)
      } else {
        this.selectedIds.push(id)
      }
    },

    selectAll() {
      const currentIds = this.filteredItems.map(i => i.id)
      if (this.selectedIds.length === currentIds.length) {
        this.selectedIds = []
      } else {
        this.selectedIds = [...currentIds]
      }
    },
  },
})
