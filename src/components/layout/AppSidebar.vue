<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMenuStore } from '../../stores/menuStore'
import {
  Home,
  Star,
  LayoutGrid,
  BookOpen,
  FileEdit,
  Settings,
  Moon,
  Sun,
} from 'lucide-vue-next'
import { useSettingsStore } from '../../stores/settingsStore'

const route = useRoute()
const router = useRouter()
const menuStore = useMenuStore()
const settingsStore = useSettingsStore()

const isLightMode = computed(() => settingsStore.settings.personalization?.theme === 'light')

const iconComponentMap: Record<string, unknown> = {
  Home,
  Star,
  LayoutGrid,
  BookOpen,
  FileEdit,
  Settings,
}

const visibleItems = computed(() => menuStore.visibleMenuItems)

function navigate(path: string) {
  router.push(path)
}

function isActive(path: string) {
  if (path === '/') return route.path === '/'
  return route.path.startsWith(path)
}
</script>

<template>
  <aside class="w-56 h-screen flex flex-col bg-[#0f121d] border-r border-[#1e2335] select-none shrink-0 z-20">
    <!-- Logo Header -->
    <div class="h-16 flex items-center gap-3 px-6 border-b border-[#1e2335]/50">
      <div class="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 via-indigo-600 to-sky-500 p-1.5 flex items-center justify-center shadow-lg shadow-indigo-500/25 ring-1 ring-white/20 shrink-0 group transition-transform duration-200 hover:scale-105">
        <svg viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" class="w-full h-full drop-shadow-sm">
          <defs>
            <linearGradient id="logo-star-grad" x1="14" y1="2" x2="14" y2="8" gradientUnits="userSpaceOnUse">
              <stop stop-color="#ffffff" />
              <stop offset="1" stop-color="#bae6fd" />
            </linearGradient>
            <linearGradient id="logo-book-left" x1="4" y1="10" x2="14" y2="23" gradientUnits="userSpaceOnUse">
              <stop stop-color="#ffffff" stop-opacity="0.95" />
              <stop offset="1" stop-color="#c7d2fe" stop-opacity="0.85" />
            </linearGradient>
            <linearGradient id="logo-book-right" x1="24" y1="10" x2="14" y2="23" gradientUnits="userSpaceOnUse">
              <stop stop-color="#ffffff" />
              <stop offset="1" stop-color="#e0e7ff" />
            </linearGradient>
          </defs>
          <!-- Spark / Beacon of Knowledge -->
          <path d="M14 2L15.3 5.4L18.5 6.2L15.3 7L14 10.2L12.7 7L9.5 6.2L12.7 5.4L14 2Z" fill="url(#logo-star-grad)" />
          <!-- Left Page / Wing -->
          <path d="M4.5 21.5C7.8 19.3 11 19.3 13.8 21V10.5C11 9 7.8 9 4.5 10.5V21.5Z" fill="url(#logo-book-left)" />
          <!-- Right Page / Wing -->
          <path d="M23.5 21.5C20.2 19.3 17 19.3 14.2 21V10.5C17 9 20.2 9 23.5 10.5V21.5Z" fill="url(#logo-book-right)" />
          <!-- Center Island Spine / Lighthouse beam line -->
          <path d="M14 10.5V21.2" stroke="#4f46e5" stroke-width="1.2" stroke-linecap="round" />
          <!-- Island Horizon Base Wave -->
          <path d="M5 24.5C9 23 19 23 23 24.5" stroke="#ffffff" stroke-opacity="0.5" stroke-width="1.4" stroke-linecap="round" />
        </svg>
      </div>
      <span class="text-xl font-bold tracking-wider text-white">研习岛</span>
    </div>

    <!-- Navigation List -->
    <nav class="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
      <button
        v-for="item in visibleItems"
        :key="item.id"
        @click="navigate(item.path)"
        :class="[
          'w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 text-left',
          isActive(item.path)
            ? 'bg-[#1c2237] text-white shadow-md shadow-indigo-950/40 border border-indigo-500/30'
            : 'text-slate-400 hover:text-slate-200 hover:bg-[#151928]'
        ]"
      >
        <component
          :is="iconComponentMap[item.iconName] || LayoutGrid"
          :class="['w-5 h-5 shrink-0', isActive(item.path) ? 'text-indigo-400' : 'text-slate-400']"
        />
        <span>{{ item.label }}</span>
      </button>
    </nav>

    <!-- Bottom Theme Mode Toggle -->
    <div class="p-3 border-t" :class="isLightMode ? 'border-slate-200' : 'border-[#1e2335]/50'">
      <button
        @click="settingsStore.toggleTheme()"
        class="w-full flex items-center justify-between px-3 py-2 rounded-xl transition-all duration-200 cursor-pointer group border"
        :class="isLightMode ? 'bg-slate-100 hover:bg-slate-200/80 border-slate-200 text-slate-700' : 'bg-[#151928]/80 hover:bg-[#1a2034] border-[#22283e] text-slate-300'"
        :title="isLightMode ? '点击切换为深色模式' : '点击切换为浅色模式'"
      >
        <div class="flex items-center gap-2.5 text-xs">
          <Sun v-if="isLightMode" class="w-4 h-4 text-amber-500 shrink-0" />
          <Moon v-else class="w-4 h-4 text-indigo-400 shrink-0" />
          <span :class="isLightMode ? 'font-semibold text-slate-800' : 'font-medium text-slate-300 group-hover:text-white'">
            {{ isLightMode ? '浅色模式' : '深色模式' }}
          </span>
        </div>

        <!-- Animated switch pill -->
        <div
          class="w-9 h-5 rounded-full p-0.5 transition-colors relative flex items-center shrink-0"
          :class="isLightMode ? 'bg-amber-100 border border-amber-300 justify-end' : 'bg-[#0f121d] border border-[#27304e] justify-start'"
        >
          <div
            class="w-3.5 h-3.5 rounded-full shadow-sm transition-transform"
            :class="isLightMode ? 'bg-amber-500' : 'bg-indigo-400'"
          ></div>
        </div>
      </button>
    </div>
  </aside>
</template>
