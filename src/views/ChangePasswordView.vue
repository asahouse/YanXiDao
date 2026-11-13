<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '../stores/userStore'
import { KeyRound, CheckCircle2, AlertTriangle, Lock } from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const token = ref((route.query.token as string) || '')
const verifying = ref(true)
const isValid = ref(false)
const targetEmail = ref('')
const targetNickname = ref('')
const errorMsg = ref('')

const newPassword = ref('')
const confirmPassword = ref('')
const submitting = ref(false)
const done = ref(false)

onMounted(async () => {
  if (!token.value) {
    verifying.value = false
    isValid.value = false
    errorMsg.value = '缺少安全改密凭证（Token），请通过邮件中的链接访问或登录后修改密码。'
    return
  }
  try {
    const res = await fetch(`/api/auth/verify-reset-token?token=${encodeURIComponent(token.value)}`)
    const data = await res.json()
    if (data.valid) {
      isValid.value = true
      targetEmail.value = data.email
      targetNickname.value = data.nickname
    } else {
      isValid.value = false
      errorMsg.value = data.error || '改密链接无效或已过期'
    }
  } catch {
    errorMsg.value = '网络异常，无法校验链接'
  } finally {
    verifying.value = false
  }
})

async function handleSubmit() {
  if (newPassword.value.length < 6) {
    errorMsg.value = '新密码长度不能少于 6 位'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    errorMsg.value = '两次输入的密码不一致'
    return
  }
  submitting.value = true
  errorMsg.value = ''
  try {
    await userStore.resetByToken(token.value, newPassword.value)
    done.value = true
    setTimeout(() => {
      router.push('/')
    }, 1600)
  } catch (err: unknown) {
    errorMsg.value = (err as Error).message || '密码设置失败'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="min-h-screen w-full flex items-center justify-center bg-[#0a0c13] text-white p-4">
    <div class="w-full max-w-md bg-[#121625] border border-[#252c44] rounded-3xl p-8 shadow-2xl">
      <div class="text-center mb-6">
        <div class="w-12 h-12 mx-auto mb-3 rounded-2xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
          <KeyRound class="w-6 h-6" />
        </div>
        <h1 class="text-xl font-bold">设置新的登录密码</h1>
        <p v-if="targetEmail" class="text-xs text-slate-400 mt-1">
          账号：{{ targetNickname }} ({{ targetEmail }})
        </p>
      </div>

      <div v-if="verifying" class="text-center py-8 text-sm text-slate-400">
        正在校验安全链接有效性...
      </div>

      <div v-else-if="done" class="text-center py-6 space-y-3">
        <CheckCircle2 class="w-12 h-12 text-emerald-400 mx-auto" />
        <p class="text-base font-semibold text-emerald-300">密码设置成功！</p>
        <p class="text-xs text-slate-400">正在为您自动登录并跳转至研习岛首页...</p>
      </div>

      <div v-else-if="!isValid" class="text-center py-6 space-y-4">
        <AlertTriangle class="w-10 h-10 text-amber-400 mx-auto" />
        <p class="text-sm text-rose-300">{{ errorMsg }}</p>
        <router-link
          to="/login"
          class="inline-block px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white"
        >
          前往登录页
        </router-link>
      </div>

      <form v-else @submit.prevent="handleSubmit" class="space-y-4">
        <div v-if="errorMsg" class="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
          {{ errorMsg }}
        </div>

        <div>
          <label class="block text-xs font-medium text-slate-400 mb-1.5">新密码（至少 6 位）</label>
          <div class="relative">
            <Lock class="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              v-model="newPassword"
              type="password"
              required
              minlength="6"
              placeholder="请输入新密码"
              class="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#181d30] border border-[#2a3350] text-sm text-white focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        <div>
          <label class="block text-xs font-medium text-slate-400 mb-1.5">确认新密码</label>
          <div class="relative">
            <Lock class="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              v-model="confirmPassword"
              type="password"
              required
              minlength="6"
              placeholder="请再次输入新密码"
              class="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#181d30] border border-[#2a3350] text-sm text-white focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        <button
          type="submit"
          :disabled="submitting"
          class="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-sm transition-colors cursor-pointer"
        >
          {{ submitting ? '提交中...' : '确认设置并自动登录' }}
        </button>
      </form>
    </div>
  </div>
</template>
