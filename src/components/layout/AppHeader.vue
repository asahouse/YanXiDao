<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '../../stores/userStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { VIP_TYPE_INFO } from '../../utils/levelRules'
import { Clock, Sun, Moon, Flame, Sparkles, Crown, Award, LogIn } from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const settingsStore = useSettingsStore()

const isCheckingIn = ref(false)
const showCheckinToast = ref(false)
const checkinToastMsg = ref('')

async function handleCheckin() {
  if (isCheckingIn.value) return
  isCheckingIn.value = true
  try {
    const res = await userStore.checkIn()
    if (res) {
      checkinToastMsg.value = res.message || (res.alreadyCheckedIn ? '今日已完成打卡' : '打卡成功！')
      showCheckinToast.value = true
      setTimeout(() => {
        showCheckinToast.value = false
      }, 2500)
    }
  } finally {
    isCheckingIn.value = false
  }
}

const pageTitle = computed(() => {
  switch (route.name) {
    case 'home':
      return '首页'
    case 'favorites':
      return '我的收藏'
    case 'courses':
      return '课程广场'
    case 'teaching':
      return '教辅广场'
    case 'course-detail':
      return '课程详情'
    case 'review':
      return '复习本'
    case 'settings':
      return '设置'
    default:
      return '研习岛'
  }
})

const formattedRemainingQuota = computed(() => {
  if (userStore.vipActive) return '无限时'
  const secs = userStore.remainingFreeSeconds
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
})

const vipBadgeLabel = computed(() => {
  if (userStore.vipActive) {
    return VIP_TYPE_INFO[userStore.profile.vipType]?.shortLabel || 'VIP'
  }
  if (userStore.hasGrayVipBadge && userStore.profile.lastVipType) {
    return VIP_TYPE_INFO[userStore.profile.lastVipType]?.shortLabel || 'VIP'
  }
  return ''
})

function openLevelTab() {
  userStore.userCenterTab = 'level'
  userStore.showUserCenterModal = true
}
</script>

<template>
  <header class="h-16 flex items-center justify-between px-6 border-b border-[#1e2335]/70 bg-[#0c0e17]/80 backdrop-blur select-none z-10 shrink-0">
    <!-- Breadcrumb -->
    <div class="flex items-center gap-2.5 text-sm text-slate-300">
      <div class="w-2 h-2 rounded-full bg-indigo-500"></div>
      <span class="font-medium tracking-wide">{{ pageTitle }}</span>
    </div>

    <!-- Right Controls & User Status Pill -->
    <div class="flex items-center gap-2.5">
      <!-- Level & Daily Quota Pill -->
      <button
        @click="openLevelTab"
        class="hidden md:flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-[#151928] hover:bg-[#1d2338] border border-[#262c44] transition-all cursor-pointer text-xs"
        :title="`Lv.${userStore.levelInfo.level} ${userStore.levelInfo.title} | 经验 ${userStore.levelInfo.exp} | 点击查看等级特权`"
      >
        <span class="flex items-center gap-1 font-bold text-indigo-300">
          <Award class="w-3.5 h-3.5 text-indigo-400" />
          Lv.{{ userStore.levelInfo.level }}
        </span>
        <div class="w-12 h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div
            class="h-full bg-gradient-to-r from-indigo-500 to-cyan-400 transition-all duration-300"
            :style="{ width: `${userStore.levelInfo.progressPercent}%` }"
          ></div>
        </div>
        <span
          v-if="userStore.vipActive"
          class="flex items-center gap-1 text-amber-400 font-semibold text-[11px]"
        >
          <Crown class="w-3.5 h-3.5 fill-amber-400/20" />
          <span>无限时</span>
          <span v-if="userStore.vipRemainingDays !== null && userStore.vipRemainingDays <= 3" class="text-[10px] text-rose-400">
            (剩{{ userStore.vipRemainingDays }}天)
          </span>
        </span>
        <span
          v-else
          class="flex items-center gap-1 text-[11px] font-mono"
          :class="userStore.remainingFreeSeconds <= 120 ? 'text-rose-400 font-semibold' : 'text-slate-300'"
        >
          <Clock class="w-3 h-3" />
          <span>今日剩 {{ formattedRemainingQuota }}</span>
        </span>
      </button>

      <!-- Quick Theme Switcher -->
      <button
        @click="settingsStore.toggleTheme()"
        class="header-theme-btn p-2 rounded-full bg-[#151928] hover:bg-[#1d2338] border border-[#262c44] text-slate-300 hover:text-white transition-all cursor-pointer"
        :title="settingsStore.settings.personalization?.theme === 'light' ? '切换为深色模式' : '切换为浅色模式'"
      >
        <Sun v-if="settingsStore.settings.personalization?.theme === 'light'" class="w-4 h-4 text-amber-500" />
        <Moon v-else class="w-4 h-4 text-indigo-400" />
      </button>

      <!-- Daily Continuous Check-in -->
      <div class="relative">
        <button
          @click="handleCheckin"
          :disabled="isCheckingIn"
          :class="[
            'header-checkin-btn flex items-center gap-1.5 px-3 py-1.5 rounded-full border transition-all cursor-pointer select-none text-xs font-medium',
            userStore.profile.hasCheckedInToday
              ? 'header-checkin-active bg-amber-500/15 hover:bg-amber-500/25 border-amber-500/40 text-amber-400 shadow-sm shadow-amber-500/10'
              : 'header-checkin-pending bg-[#151928] hover:bg-[#1d2338] border-[#262c44] text-slate-400 hover:text-amber-300 hover:border-amber-500/30 opacity-75 hover:opacity-100'
          ]"
          :title="userStore.profile.hasCheckedInToday
            ? `今日已完成打卡，已连续打卡 ${userStore.profile.continuousDays} 天`
            : `今日未打卡，点击立即打卡 (连续 ${userStore.profile.continuousDays} 天)`"
        >
          <Flame
            :class="[
              'w-4 h-4 shrink-0 transition-transform duration-300',
              userStore.profile.hasCheckedInToday
                ? 'fill-amber-400 text-amber-400 scale-105'
                : 'text-slate-400'
            ]"
          />
          <span class="font-mono whitespace-nowrap">
            {{ userStore.profile.hasCheckedInToday ? `已打卡 ${userStore.profile.continuousDays}天` : `打卡 · ${userStore.profile.continuousDays}天` }}
          </span>
        </button>

        <!-- Checkin Toast Tip -->
        <transition name="fade">
          <div
            v-if="showCheckinToast"
            class="header-checkin-toast absolute top-full left-1/2 -translate-x-1/2 mt-2 px-3 py-1.5 rounded-lg bg-indigo-950/95 border border-indigo-500/40 text-indigo-200 text-xs shadow-xl whitespace-nowrap z-50 pointer-events-none flex items-center gap-1.5"
          >
            <Sparkles class="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>{{ checkinToastMsg }}</span>
          </div>
        </transition>
      </div>

      <!-- User Avatar / Profile Button -->
      <button
        @click="userStore.userCenterTab = 'info'; userStore.showUserCenterModal = true"
        class="header-avatar-btn flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-[#151928] hover:bg-[#1d2338] border border-[#262c44] transition-all cursor-pointer group"
      >
        <div
          class="user-avatar-wrap w-7 h-7 rounded-full overflow-hidden flex items-center justify-center shrink-0 ring-2"
          :class="userStore.vipActive ? 'ring-amber-400' : 'ring-indigo-500/40'"
        >
          <img
            :src="userStore.profile.avatar"
            alt="Avatar"
            class="user-avatar-img w-full h-full rounded-full object-cover"
          />
        </div>
        <div class="flex items-center gap-1.5 text-xs">
          <span class="font-semibold text-slate-200 group-hover:text-white transition-colors">
            {{ userStore.profile.nickname }}
          </span>
          <!-- Active Gold VIP Badge -->
          <span
            v-if="userStore.vipActive"
            class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-bold text-[10px] border border-amber-500/40"
            :title="userStore.profile.vipExpireAt ? `有效期至 ${userStore.profile.vipExpireAt}` : '终身永久有效'"
          >
            <Crown class="w-2.5 h-2.5 fill-amber-400 text-amber-400" />
            {{ vipBadgeLabel }}
          </span>
          <!-- Grayed-out Expired VIP Badge -->
          <span
            v-else-if="userStore.hasGrayVipBadge"
            class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-800 text-slate-500 font-medium text-[10px] border border-slate-700 grayscale"
            :title="`VIP 已过期，续费即可重新点亮徽章并恢复无限时长`"
          >
            <Crown class="w-2.5 h-2.5 text-slate-500" />
            {{ vipBadgeLabel }}(已过期)
          </span>
          <!-- Free user tag -->
          <span
            v-else
            class="px-2 py-0.5 rounded-full bg-[#20263c] text-indigo-300 font-medium text-[10px] border border-indigo-500/20"
          >
            普通用户
          </span>
        </div>
      </button>

      <!-- Login Button if unauthenticated -->
      <button
        v-if="!userStore.isAuthenticated"
        @click="router.push('/login')"
        class="px-3 py-1.5 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors"
        title="使用邮箱账号登录"
      >
        <LogIn class="w-3.5 h-3.5" />
        <span>登录</span>
      </button>
    </div>
  </header>
</template>
