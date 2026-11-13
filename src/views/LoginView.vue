<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '../stores/userStore'
import { Mail, Lock, LogIn, Sparkles, KeyRound, ArrowLeft } from 'lucide-vue-next'

const router = useRouter()
const userStore = useUserStore()

const email = ref('')
const password = ref('')
const loading = ref(false)
const errorMsg = ref('')
const successMsg = ref('')
const isForgotMode = ref(false)

async function handleLogin() {
  if (!email.value.trim() || !password.value) {
    errorMsg.value = '请输入邮箱和密码'
    return
  }
  loading.value = true
  errorMsg.value = ''
  try {
    await userStore.login(email.value.trim(), password.value)
    router.push('/')
  } catch (err: unknown) {
    errorMsg.value = (err as Error).message || '登录失败'
  } finally {
    loading.value = false
  }
}

async function handleForgotPassword() {
  if (!email.value.trim()) {
    errorMsg.value = '请输入您的注册邮箱'
    return
  }
  loading.value = true
  errorMsg.value = ''
  successMsg.value = ''
  try {
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.value.trim() }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '发送失败')
    successMsg.value = data.message || '重置邮件已发送，请查收邮箱'
  } catch (err: unknown) {
    errorMsg.value = (err as Error).message || '请求失败'
  } finally {
    loading.value = false
  }
}

async function handleDemoLogin() {
  loading.value = true
  errorMsg.value = ''
  try {
    await userStore.demoLogin()
    router.push('/')
  } catch (err: unknown) {
    errorMsg.value = (err as Error).message || '体验登录失败'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen w-full flex items-center justify-center bg-[#0a0c13] text-white p-4 relative overflow-hidden">
    <div class="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-900/25 via-[#0a0c13] to-[#0a0c13] pointer-events-none"></div>

    <div class="w-full max-w-md bg-[#121625]/95 border border-[#252c44] rounded-3xl p-8 shadow-2xl relative z-10 backdrop-blur-xl">
      <!-- Brand Header -->
      <div class="text-center mb-8">
        <div class="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-indigo-500/30">
          <Sparkles class="w-7 h-7 text-white" />
        </div>
        <h1 class="text-2xl font-bold tracking-tight text-white">研习岛 · 学员登录</h1>
        <p class="text-xs text-slate-400 mt-1.5">
          {{ isForgotMode ? '输入注册邮箱，获取 8 位临时密码与改密链接' : '使用管理员开通的邮箱与密码登录开启沉浸研习' }}
        </p>
      </div>

      <!-- Disabled / Error Alert -->
      <div v-if="userStore.disabledNotice || errorMsg" class="mb-5 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
        {{ userStore.disabledNotice || errorMsg }}
      </div>
      <div v-if="successMsg" class="mb-5 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs">
        {{ successMsg }}
      </div>

      <!-- Login Form -->
      <form v-if="!isForgotMode" @submit.prevent="handleLogin" class="space-y-4">
        <div>
          <label class="block text-xs font-medium text-slate-400 mb-1.5">登录邮箱</label>
          <div class="relative">
            <Mail class="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              v-model="email"
              type="email"
              required
              placeholder="name@example.com"
              class="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#181d30] border border-[#2a3350] text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>
        </div>

        <div>
          <div class="flex items-center justify-between mb-1.5">
            <label class="text-xs font-medium text-slate-400">密码（或 8 位临时密码）</label>
            <button
              type="button"
              @click="isForgotMode = true; errorMsg = ''; successMsg = ''"
              class="text-xs text-indigo-400 hover:text-indigo-300 cursor-pointer"
            >
              忘记密码？
            </button>
          </div>
          <div class="relative">
            <Lock class="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              v-model="password"
              type="password"
              required
              placeholder="••••••••"
              class="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#181d30] border border-[#2a3350] text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>
        </div>

        <button
          type="submit"
          :disabled="loading"
          class="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/30 transition-all cursor-pointer mt-2"
        >
          <LogIn class="w-4 h-4" />
          <span>{{ loading ? '登录中...' : '立即登录' }}</span>
        </button>
      </form>

      <!-- Forgot Password Form -->
      <form v-else @submit.prevent="handleForgotPassword" class="space-y-4">
        <div>
          <label class="block text-xs font-medium text-slate-400 mb-1.5">注册邮箱</label>
          <div class="relative">
            <Mail class="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              v-model="email"
              type="email"
              required
              placeholder="name@example.com"
              class="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#181d30] border border-[#2a3350] text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>
        </div>

        <button
          type="submit"
          :disabled="loading"
          class="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer"
        >
          <KeyRound class="w-4 h-4" />
          <span>{{ loading ? '发送中...' : '发送重置密码邮件' }}</span>
        </button>

        <button
          type="button"
          @click="isForgotMode = false; errorMsg = ''; successMsg = ''"
          class="w-full py-2 text-xs text-slate-400 hover:text-white flex items-center justify-center gap-1 cursor-pointer"
        >
          <ArrowLeft class="w-3.5 h-3.5" />
          <span>返回邮箱密码登录</span>
        </button>
      </form>

      <!-- Divider & Demo Account -->
      <div class="mt-6 pt-5 border-t border-[#222940] space-y-3">
        <button
          type="button"
          @click="handleDemoLogin"
          :disabled="loading"
          class="w-full py-2.5 rounded-xl bg-[#181d30] hover:bg-[#1f263f] border border-[#2b3454] text-slate-300 hover:text-white text-xs font-medium transition-colors cursor-pointer"
        >
          一键继承本地默认账号登录（本傑明 · 保留原学习记录）
        </button>
        <div class="text-center">
          <router-link to="/" class="text-[11px] text-slate-500 hover:text-slate-300">
            先逛逛首页课程 →
          </router-link>
        </div>
      </div>
    </div>
  </div>
</template>
