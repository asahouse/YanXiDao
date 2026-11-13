<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppSidebar from './components/layout/AppSidebar.vue'
import AppHeader from './components/layout/AppHeader.vue'
import UserCenterModal from './components/modals/UserCenterModal.vue'
import { useSettingsStore } from './stores/settingsStore'
import { useCourseStore } from './stores/courseStore'
import { useUserStore } from './stores/userStore'
import { useReviewStore } from './stores/reviewStore'
import { useMenuStore } from './stores/menuStore'
import { KeyRound, Lock, Sparkles } from 'lucide-vue-next'

const route = useRoute()
const settingsStore = useSettingsStore()
const courseStore = useCourseStore()
const userStore = useUserStore()
const reviewStore = useReviewStore()
const menuStore = useMenuStore()

const isPracticeView = computed(() => route.name === 'practice')
const isStandaloneLayout = computed(() => Boolean(route.meta?.standaloneLayout))

const forceNewPwd = ref('')
const forceConfirmPwd = ref('')
const forcePwdErr = ref('')
const forcePwdLoading = ref(false)

async function submitForceChangePassword() {
  if (forceNewPwd.value.length < 6) {
    forcePwdErr.value = '新密码长度不能少于 6 位'
    return
  }
  if (forceNewPwd.value !== forceConfirmPwd.value) {
    forcePwdErr.value = '两次输入的密码不一致'
    return
  }
  forcePwdLoading.value = true
  forcePwdErr.value = ''
  try {
    await userStore.changePassword('', forceNewPwd.value)
    forceNewPwd.value = ''
    forceConfirmPwd.value = ''
  } catch (err: unknown) {
    forcePwdErr.value = (err as Error).message || '修改密码失败'
  } finally {
    forcePwdLoading.value = false
  }
}

watch(
  () => userStore.levelUpToast,
  (val) => {
    if (val) {
      setTimeout(() => {
        if (userStore.levelUpToast === val) userStore.levelUpToast = ''
      }, 5000)
    }
  }
)

onMounted(async () => {
  await Promise.allSettled([
    settingsStore.fetchSettings(),
    menuStore.fetchMenu(),
    courseStore.fetchCourses(),
    userStore.fetchProfile(),
    userStore.fetchPurchases(),
    reviewStore.fetchReviews(),
  ])
  settingsStore.applyCSSVariables()
})
</script>

<template>
  <!-- Fullscreen container with dark mode base -->
  <div class="min-h-screen w-full bg-[#0a0c13] text-slate-100 flex flex-col antialiased">
    <!-- Standalone Layout for Admin Portal, Login, Change Password -->
    <div v-if="isStandaloneLayout" class="w-full min-h-screen">
      <router-view />
    </div>

    <!-- Immersive Practice View without standard layout shell -->
    <div v-else-if="isPracticeView" class="w-full h-screen overflow-hidden">
      <router-view />
    </div>

    <!-- Regular Platform Shell (Sidebar + Topbar + Content) -->
    <div v-else class="flex w-full h-screen overflow-hidden">
      <AppSidebar />
      <div class="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        <AppHeader />
        <main class="flex-1 overflow-y-auto bg-[#0a0c13]">
          <router-view />
        </main>
      </div>
    </div>

    <!-- Global User Center Modal -->
    <UserCenterModal v-if="!isStandaloneLayout" />

    <!-- Forced First-Login Password Change Modal -->
    <div
      v-if="userStore.showForceChangePwdModal && !isStandaloneLayout"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
    >
      <div class="w-full max-w-md bg-[#141827] border border-indigo-500/30 rounded-2xl p-6 shadow-2xl space-y-4">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
            <KeyRound class="w-5 h-5" />
          </div>
          <div>
            <h3 class="text-base font-bold text-white">首次登录请修改密码</h3>
            <p class="text-xs text-slate-400">您当前使用的是系统临时密码，请设置专属新密码以确保账号安全</p>
          </div>
        </div>

        <div v-if="forcePwdErr" class="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
          {{ forcePwdErr }}
        </div>

        <form @submit.prevent="submitForceChangePassword" class="space-y-3">
          <div>
            <label class="block text-xs text-slate-400 mb-1">新密码（至少 6 位）</label>
            <div class="relative">
              <Lock class="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                v-model="forceNewPwd"
                type="password"
                required
                minlength="6"
                placeholder="请输入新密码"
                class="w-full pl-9 pr-3 py-2 rounded-xl bg-[#1b2136] border border-[#2b3454] text-sm text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>
          <div>
            <label class="block text-xs text-slate-400 mb-1">确认新密码</label>
            <div class="relative">
              <Lock class="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                v-model="forceConfirmPwd"
                type="password"
                required
                minlength="6"
                placeholder="请再次输入新密码"
                class="w-full pl-9 pr-3 py-2 rounded-xl bg-[#1b2136] border border-[#2b3454] text-sm text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>
          <button
            type="submit"
            :disabled="forcePwdLoading"
            class="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold cursor-pointer"
          >
            {{ forcePwdLoading ? '保存中...' : '确认修改并继续使用' }}
          </button>
        </form>
      </div>
    </div>

    <!-- Global Level Up Celebration Toast -->
    <div
      v-if="userStore.levelUpToast"
      class="fixed top-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl bg-gradient-to-r from-indigo-600 to-amber-500 text-white text-xs font-bold shadow-2xl border border-amber-300/40 flex items-center gap-2 animate-bounce"
    >
      <Sparkles class="w-4 h-4" />
      <span>{{ userStore.levelUpToast }}</span>
    </div>
  </div>
</template>
