<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '../../stores/userStore'
import { LEVEL_TABLE, DAILY_EXP_CAP, VIP_TYPE_INFO, getHigherVipTypes, type VipType } from '../../utils/levelRules'
import { userFetch } from '../../utils/userApi'
import { splitTextWithLinks } from '../../utils/textLinks'
import { X, Copy, Check, Edit3, LogOut, CheckCircle2, Crown, Award, KeyRound, Mail, Sparkles, Send, MessageSquare } from 'lucide-vue-next'
import AvatarSelectModal from './AvatarSelectModal.vue'

const router = useRouter()
const userStore = useUserStore()

const activeTab = ref<'profile' | 'level'>('profile')
const isEditingNickname = ref(false)
const nicknameInput = ref(userStore.profile.nickname)
const copied = ref(false)
const showLogoutConfirm = ref(false)
const showAvatarSelectModal = ref(false)
const toastMsg = ref('')

// Change Password form inside UserCenterModal
const showChangePwdForm = ref(false)
const oldPwd = ref('')
const newPwd = ref('')
const confirmPwd = ref('')
const pwdError = ref('')
const pwdLoading = ref(false)

function showToast(msg: string) {
  toastMsg.value = msg
  setTimeout(() => {
    toastMsg.value = ''
  }, 2500)
}

function copyId() {
  navigator.clipboard.writeText(userStore.profile.id)
  copied.value = true
  showToast('ID已复制')
  setTimeout(() => {
    copied.value = false
  }, 2000)
}

function saveNickname() {
  if (nicknameInput.value.trim()) {
    userStore.updateNickname(nicknameInput.value)
    isEditingNickname.value = false
    showToast('昵称已更新')
  }
}

function handleAvatarChange() {
  showAvatarSelectModal.value = true
}

function handleResetAvatar() {
  userStore.resetDefaultAvatar()
  showToast('已恢复默认头像')
}

async function submitChangePassword() {
  pwdError.value = ''
  if (!oldPwd.value || !newPwd.value) {
    pwdError.value = '请填写原密码和新密码'
    return
  }
  if (newPwd.value.length < 6) {
    pwdError.value = '新密码长度不能少于 6 位'
    return
  }
  if (newPwd.value !== confirmPwd.value) {
    pwdError.value = '两次输入的新密码不一致'
    return
  }
  pwdLoading.value = true
  try {
    await userStore.changePassword(oldPwd.value, newPwd.value)
    showChangePwdForm.value = false
    oldPwd.value = ''
    newPwd.value = ''
    confirmPwd.value = ''
    showToast('密码修改成功')
  } catch (err: any) {
    pwdError.value = err.message || '修改失败'
  } finally {
    pwdLoading.value = false
  }
}

function goToLogin() {
  userStore.showUserCenterModal = false
  router.push('/login')
}

function handleLogout() {
  showLogoutConfirm.value = false
  userStore.logout()
  userStore.showUserCenterModal = false
  router.push('/login')
}

// ==================== VIP Upgrade Applications ====================
interface VipRequestItem {
  id: string
  currentVipType: VipType
  targetVipType: VipType
  status: 'pending' | 'replied' | 'approved' | 'rejected'
  createdAt: string
  updatedAt: string
}
interface VipMessageItem {
  id: string
  requestId: string
  senderRole: 'user' | 'admin'
  senderName: string
  content: string
  createdAt: string
}

const vipReqLoading = ref(false)
const vipRequests = ref<VipRequestItem[]>([])
const vipMessagesMap = ref<Record<string, VipMessageItem[]>>({})
const processedVipTypes = ref<VipType[]>([])
const openVipTypes = ref<VipType[]>([])
const selectedTargetVip = ref<VipType | ''>('')
const vipApplyNote = ref('')
const vipApplyBusy = ref(false)
const vipApplyErr = ref('')
const vipReplyDrafts = ref<Record<string, string>>({})
const vipReplyBusy = ref<Record<string, boolean>>({})

const vipStatusLabels: Record<string, { text: string; cls: string }> = {
  pending: { text: '待审核', cls: 'bg-amber-500/20 text-amber-300' },
  replied: { text: '已回复链接', cls: 'bg-indigo-500/20 text-indigo-300' },
  approved: { text: '已通过', cls: 'bg-emerald-500/20 text-emerald-300' },
  rejected: { text: '未通过', cls: 'bg-rose-500/20 text-rose-300' },
}

const currentEffectiveVip = computed<VipType>(() =>
  userStore.vipActive ? (userStore.profile.vipType || 'free') : 'free'
)

const higherVipOptions = computed(() => {
  const higher = getHigherVipTypes(currentEffectiveVip.value)
  return higher.map((type) => {
    const isProcessed = processedVipTypes.value.includes(type)
    const isOpen = openVipTypes.value.includes(type)
    return {
      type,
      label: VIP_TYPE_INFO[type]?.label || type,
      disabled: isProcessed || isOpen,
      reason: isProcessed ? '已申请并处理' : isOpen ? '申请审核中' : '',
    }
  })
})

async function fetchVipRequests() {
  if (!userStore.isAuthenticated) return
  vipReqLoading.value = true
  try {
    const res = await userFetch('/api/user/vip-requests')
    if (!res.ok) return
    const data = await res.json()
    vipRequests.value = data.requests || []
    vipMessagesMap.value = data.messagesMap || {}
    processedVipTypes.value = data.processedTypes || []
    openVipTypes.value = data.openTypes || []
    const firstAvailable = higherVipOptions.value.find(o => !o.disabled)
    if (selectedTargetVip.value) {
      const stillValid = higherVipOptions.value.some(o => o.type === selectedTargetVip.value && !o.disabled)
      if (!stillValid) selectedTargetVip.value = firstAvailable ? firstAvailable.type : ''
    } else {
      selectedTargetVip.value = firstAvailable ? firstAvailable.type : ''
    }
  } finally {
    vipReqLoading.value = false
  }
}

async function submitVipRequest() {
  vipApplyErr.value = ''
  if (!selectedTargetVip.value) {
    vipApplyErr.value = '请选择可申请的更高会员类型'
    return
  }
  vipApplyBusy.value = true
  try {
    const res = await userFetch('/api/user/vip-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetVipType: selectedTargetVip.value,
        note: vipApplyNote.value.trim(),
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '提交申请失败')
    vipApplyNote.value = ''
    showToast('会员升级申请已提交')
    await fetchVipRequests()
  } catch (e: any) {
    vipApplyErr.value = e.message || '提交失败'
  } finally {
    vipApplyBusy.value = false
  }
}

async function sendUserVipReply(requestId: string) {
  const content = (vipReplyDrafts.value[requestId] || '').trim()
  if (!content) return
  vipReplyBusy.value[requestId] = true
  try {
    const res = await userFetch(`/api/user/vip-requests/${requestId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '回复失败')
    vipReplyDrafts.value[requestId] = ''
    await fetchVipRequests()
  } catch (e: any) {
    showToast(e.message || '回复失败')
  } finally {
    vipReplyBusy.value[requestId] = false
  }
}

watch(
  () => [userStore.showUserCenterModal, activeTab.value],
  ([open, tab]) => {
    if (open && tab === 'level' && userStore.isAuthenticated) {
      fetchVipRequests()
    }
  },
  { immediate: true }
)
</script>

<template>
  <div
    v-if="userStore.showUserCenterModal"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 select-none"
    @click.self="userStore.showUserCenterModal = false"
  >
    <!-- Modal Container -->
    <div class="w-full max-w-xl bg-[#181c2b] border border-[#272d45] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] transition-all">
      <!-- Header with Title and Close Button -->
      <div class="flex items-center justify-between px-6 pt-5 pb-3 border-b border-[#252b41] shrink-0">
        <div class="flex items-center gap-4">
          <button
            @click="activeTab = 'profile'"
            :class="[
              'text-sm font-bold pb-1 border-b-2 transition-colors cursor-pointer',
              activeTab === 'profile' ? 'text-white border-indigo-500' : 'text-slate-400 border-transparent hover:text-slate-200'
            ]"
          >
            个人资料与账户
          </button>
          <button
            @click="activeTab = 'level'"
            :class="[
              'text-sm font-bold pb-1 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5',
              activeTab === 'level' ? 'text-white border-amber-400' : 'text-slate-400 border-transparent hover:text-slate-200'
            ]"
          >
            <Crown class="w-3.5 h-3.5 text-amber-400" />
            <span>等级与VIP特权</span>
          </button>
        </div>
        <button
          @click="userStore.showUserCenterModal = false"
          class="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#23293f] transition-colors cursor-pointer"
        >
          <X class="w-5 h-5" />
        </button>
      </div>

      <!-- Toast Feedback inside modal -->
      <div v-if="toastMsg" class="mx-6 mt-3 px-3 py-1.5 rounded-lg bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 text-xs flex items-center gap-2 shrink-0">
        <CheckCircle2 class="w-4 h-4 text-indigo-400" />
        <span>{{ toastMsg }}</span>
      </div>

      <!-- Tab 1: Personal Info -->
      <div v-if="activeTab === 'profile'" class="p-6 space-y-3.5 overflow-y-auto">
        <!-- Avatar card -->
        <div class="user-center-card flex items-center justify-between p-4 rounded-xl bg-[#1d2235] border border-[#272d45]">
          <div class="flex items-center gap-4">
            <div
              class="user-avatar-wrap w-14 h-14 rounded-full ring-2 ring-indigo-500/50 cursor-pointer hover:opacity-90 transition-all p-0.5 overflow-hidden flex items-center justify-center shrink-0 shadow-md"
              @click="handleAvatarChange"
              title="点击更换头像"
            >
              <img
                :src="userStore.profile.avatar"
                alt="Avatar"
                class="user-avatar-img w-full h-full rounded-full object-cover"
              />
            </div>
            <div>
              <div class="font-bold text-slate-100 flex items-center gap-2">
                <span>{{ userStore.profile.nickname }}</span>
                <span class="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono">Lv.{{ userStore.levelInfo.level }}</span>
              </div>
              <button
                @click="handleAvatarChange"
                class="text-xs text-indigo-400 hover:underline cursor-pointer flex items-center gap-1 mt-0.5"
              >
                <span>点击更换头像</span>
              </button>
            </div>
          </div>
          <button
            @click="handleResetAvatar"
            class="px-3 py-1.5 rounded-lg bg-[#272e47] hover:bg-[#323a59] text-xs font-medium text-slate-300 transition-colors cursor-pointer"
          >
            恢复默认头像
          </button>
        </div>

        <!-- Email Card -->
        <div class="user-center-card flex items-center justify-between p-3.5 rounded-xl bg-[#1d2235] border border-[#272d45] text-sm">
          <span class="text-slate-400 font-medium flex items-center gap-1.5">
            <Mail class="w-4 h-4 text-slate-400" />
            <span>绑定邮箱</span>
          </span>
          <span class="text-slate-200 font-mono text-xs">{{ userStore.profile.email || '未绑定邮箱' }}</span>
        </div>

        <!-- ID Card -->
        <div class="user-center-card flex items-center justify-between p-3.5 rounded-xl bg-[#1d2235] border border-[#272d45] text-sm">
          <span class="text-slate-400 font-medium">ID</span>
          <div class="flex items-center gap-2">
            <span class="text-slate-200 font-mono font-medium">{{ userStore.profile.id }}</span>
            <button
              @click="copyId"
              class="p-1.5 rounded-md hover:bg-[#2b334d] text-slate-400 hover:text-white transition-colors cursor-pointer"
              title="复制ID"
            >
              <Check v-if="copied" class="w-4 h-4 text-emerald-400" />
              <Copy v-else class="w-4 h-4" />
            </button>
          </div>
        </div>

        <!-- Nickname Card -->
        <div class="user-center-card flex items-center justify-between p-3.5 rounded-xl bg-[#1d2235] border border-[#272d45] text-sm">
          <span class="text-slate-400 font-medium">昵称</span>
          <div v-if="!isEditingNickname" class="flex items-center gap-2">
            <span class="text-slate-200 font-medium">{{ userStore.profile.nickname }}</span>
            <button
              @click="isEditingNickname = true"
              class="p-1.5 rounded-md hover:bg-[#2b334d] text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              <Edit3 class="w-4 h-4" />
            </button>
          </div>
          <div v-else class="flex items-center gap-2">
            <input
              v-model="nicknameInput"
              type="text"
              class="px-2.5 py-1 rounded bg-[#121520] border border-indigo-500/50 text-white text-sm outline-none focus:ring-1 focus:ring-indigo-400"
              @keyup.enter="saveNickname"
            />
            <button
              @click="saveNickname"
              class="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white cursor-pointer"
            >
              保存
            </button>
            <button
              @click="isEditingNickname = false"
              class="px-2 py-1 rounded bg-slate-700 text-xs text-slate-300 cursor-pointer"
            >
              取消
            </button>
          </div>
        </div>

        <!-- Change Password Card -->
        <div class="user-center-card p-3.5 rounded-xl bg-[#1d2235] border border-[#272d45] text-sm space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-slate-400 font-medium flex items-center gap-1.5">
              <KeyRound class="w-4 h-4 text-slate-400" />
              <span>账号密码</span>
            </span>
            <button
              @click="showChangePwdForm = !showChangePwdForm"
              class="text-xs text-indigo-400 hover:text-indigo-300 font-medium cursor-pointer"
            >
              {{ showChangePwdForm ? '收起' : '修改密码' }}
            </button>
          </div>
          <div v-if="showChangePwdForm" class="space-y-2 pt-2 border-t border-[#272d45]">
            <input
              v-model="oldPwd"
              type="password"
              placeholder="当前密码"
              class="w-full px-3 py-2 rounded-lg bg-[#121520] border border-[#2a314a] text-white text-xs outline-none focus:border-indigo-500"
            />
            <input
              v-model="newPwd"
              type="password"
              placeholder="新密码（至少6位）"
              class="w-full px-3 py-2 rounded-lg bg-[#121520] border border-[#2a314a] text-white text-xs outline-none focus:border-indigo-500"
            />
            <input
              v-model="confirmPwd"
              type="password"
              placeholder="确认新密码"
              class="w-full px-3 py-2 rounded-lg bg-[#121520] border border-[#2a314a] text-white text-xs outline-none focus:border-indigo-500"
            />
            <p v-if="pwdError" class="text-xs text-rose-400">{{ pwdError }}</p>
            <button
              @click="submitChangePassword"
              :disabled="pwdLoading"
              class="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-bold text-white cursor-pointer"
            >
              {{ pwdLoading ? '提交中...' : '确认修改密码' }}
            </button>
          </div>
        </div>

        <!-- Account Switch / Logout Button -->
        <div class="pt-1 flex items-center gap-2.5">
          <button
            @click="goToLogin"
            class="flex-1 py-2.5 rounded-xl bg-[#252b41] hover:bg-[#2f3754] text-slate-200 font-semibold text-xs transition-colors cursor-pointer"
          >
            切换账号登录
          </button>
          <button
            @click="showLogoutConfirm = true"
            class="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600 text-white font-semibold text-xs shadow-lg shadow-pink-500/20 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <LogOut class="w-3.5 h-3.5" />
            <span>退出登录</span>
          </button>
        </div>
      </div>

      <!-- Tab 2: Level & VIP Privileges -->
      <div v-else class="p-6 space-y-4 overflow-y-auto">
        <!-- Current Level Progress Card -->
        <div class="p-4 rounded-xl bg-gradient-to-br from-[#1f253d] to-[#171b2d] border border-indigo-500/30 space-y-3">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2.5">
              <div class="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center font-black text-indigo-300 font-mono">
                {{ userStore.levelInfo.level }}
              </div>
              <div>
                <div class="text-sm font-bold text-white flex items-center gap-1.5">
                  <span>Lv.{{ userStore.levelInfo.level }} · {{ userStore.levelInfo.title }}</span>
                </div>
                <div class="text-[11px] text-slate-400">
                  今日已获经验 <span class="text-amber-400 font-mono">{{ userStore.profile.todayExp || 0 }}</span> / {{ DAILY_EXP_CAP }} EXP
                </div>
              </div>
            </div>
            <div class="text-right">
              <div class="text-xs font-mono text-indigo-300 font-bold">{{ userStore.profile.exp || 0 }} EXP</div>
              <div class="text-[10px] text-slate-500">
                {{ userStore.levelInfo.level >= 30 ? '已达满级' : `距下级还差 ${userStore.levelInfo.expRemainingToNext} EXP` }}
              </div>
            </div>
          </div>

          <div class="w-full h-2 rounded-full bg-[#101320] overflow-hidden">
            <div
              class="h-full rounded-full bg-gradient-to-r from-indigo-500 to-amber-400 transition-all duration-500"
              :style="{ width: `${userStore.levelInfo.progressPercent}%` }"
            ></div>
          </div>

          <div class="flex items-center justify-between text-[11px] text-slate-400 pt-0.5">
            <span>当前每日免费额度：<strong class="text-emerald-400">{{ userStore.levelInfo.dailyQuotaMinutes }} 分钟</strong></span>
            <span>每升 1 级 +3 分钟（满级 97 分钟）</span>
          </div>
        </div>

        <!-- VIP Membership Status Card -->
        <div
          v-if="userStore.vipActive"
          class="p-4 rounded-xl bg-gradient-to-r from-amber-500/15 to-yellow-500/10 border border-amber-400/40 flex items-center justify-between"
        >
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-amber-400/20 flex items-center justify-center text-amber-300">
              <Crown class="w-5 h-5" />
            </div>
            <div>
              <div class="text-sm font-bold text-amber-300 flex items-center gap-2">
                <span>{{ VIP_TYPE_INFO[userStore.profile.vipType || 'free']?.label }}</span>
                <span class="text-[10px] px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-200">生效中</span>
              </div>
              <div class="text-[11px] text-amber-200/70 mt-0.5">
                无限练习时长 · 1.25x 经验加成 ·
                {{ userStore.profile.vipType === 'vip_lifetime' ? '终身有效' : `剩余 ${userStore.vipRemainingDays} 天 (至 ${userStore.profile.vipExpireAt || '-'})` }}
              </div>
            </div>
          </div>
        </div>

        <div
          v-else-if="userStore.hasGrayVipBadge"
          class="p-4 rounded-xl bg-[#1b1f2e] border border-slate-600/50 flex items-center justify-between opacity-85"
        >
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-slate-700/40 flex items-center justify-center text-slate-400 grayscale">
              <Award class="w-5 h-5" />
            </div>
            <div>
              <div class="text-sm font-bold text-slate-300 flex items-center gap-2">
                <span>尊享会员徽章</span>
                <span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">已过期（置灰保留）</span>
              </div>
              <div class="text-[11px] text-slate-400 mt-0.5">
                已恢复普通用户权益（每日 {{ userStore.levelInfo.dailyQuotaMinutes }} 分钟），您的 Lv.{{ userStore.levelInfo.level }} 等级与经验已完整保留。
              </div>
            </div>
          </div>
        </div>

        <div
          v-else
          class="p-4 rounded-xl bg-[#1b2032] border border-[#282f48] flex items-center justify-between"
        >
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-slate-400">
              <Sparkles class="w-5 h-5" />
            </div>
            <div>
              <div class="text-sm font-bold text-slate-200">普通研习用户</div>
              <div class="text-[11px] text-slate-400 mt-0.5">
                每日免费 {{ userStore.levelInfo.dailyQuotaMinutes }} 分钟，升级可不断解锁更多时长；开通 VIP 享无限时长与 1.25x 经验。
              </div>
            </div>
          </div>
        </div>

        <!-- VIP Upgrade Application & Messages -->
        <div v-if="userStore.isAuthenticated" class="p-4 rounded-xl bg-[#131726] border border-[#252c44] space-y-3">
          <div class="flex items-center justify-between">
            <div class="text-xs font-bold text-amber-300 flex items-center gap-1.5">
              <Crown class="w-4 h-4" />
              <span>申请升级会员类型</span>
            </div>
            <span class="text-[11px] text-slate-400">可申请高于当前等级的会员</span>
          </div>

          <div v-if="higherVipOptions.length === 0" class="text-xs text-emerald-400/90 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
            您当前已是最高等级「{{ VIP_TYPE_INFO[currentEffectiveVip]?.label }}」，无需继续升级。
          </div>

          <div v-else class="space-y-2.5">
            <div class="flex flex-wrap gap-2">
              <button
                v-for="opt in higherVipOptions"
                :key="opt.type"
                type="button"
                :disabled="opt.disabled"
                @click="selectedTargetVip = opt.type"
                :class="[
                  'px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all',
                  opt.disabled
                    ? 'bg-[#1a1f30] border-[#262c42] text-slate-500 cursor-not-allowed'
                    : selectedTargetVip === opt.type
                    ? 'bg-amber-500/20 border-amber-400 text-amber-200 cursor-pointer'
                    : 'bg-[#1a1f30] border-[#2c3450] text-slate-300 hover:border-amber-400/50 cursor-pointer'
                ]"
              >
                <span>{{ opt.label }}</span>
                <span v-if="opt.reason" class="ml-1.5 text-[10px] opacity-80">({{ opt.reason }})</span>
              </button>
            </div>

            <div v-if="higherVipOptions.some(o => !o.disabled)" class="flex items-center gap-2">
              <input
                v-model="vipApplyNote"
                type="text"
                placeholder="填写申请说明或联系方式（选填）"
                class="flex-1 px-3 py-1.5 rounded-lg bg-[#1a1f30] border border-[#2c3450] text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
              />
              <button
                type="button"
                :disabled="vipApplyBusy || !selectedTargetVip"
                @click="submitVipRequest"
                class="px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold cursor-pointer disabled:opacity-50 shrink-0"
              >
                {{ vipApplyBusy ? '提交中...' : '提交升级申请' }}
              </button>
            </div>

            <div v-if="vipApplyErr" class="text-[11px] text-rose-400">{{ vipApplyErr }}</div>
          </div>

          <!-- Submitted Requests & Two-Way Messages -->
          <div v-if="vipRequests.length > 0" class="pt-2 border-t border-[#22283e] space-y-2.5">
            <div class="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
              <MessageSquare class="w-3.5 h-3.5" />
              <span>我的升级申请记录与回复</span>
            </div>

            <div
              v-for="req in vipRequests"
              :key="req.id"
              class="p-3 rounded-lg bg-[#181d2f] border border-[#272f49] space-y-2"
            >
              <div class="flex items-center justify-between gap-2 text-xs">
                <div class="font-semibold text-slate-200">
                  {{ VIP_TYPE_INFO[req.currentVipType]?.label }} →
                  <span class="text-amber-300">{{ VIP_TYPE_INFO[req.targetVipType]?.label }}</span>
                </div>
                <span :class="['px-2 py-0.5 rounded text-[10px] font-semibold', vipStatusLabels[req.status]?.cls]">
                  {{ vipStatusLabels[req.status]?.text || req.status }}
                </span>
              </div>

              <div v-if="(vipMessagesMap[req.id] || []).length > 0" class="space-y-1.5">
                <div
                  v-for="msg in vipMessagesMap[req.id]"
                  :key="msg.id"
                  :class="[
                    'p-2 rounded text-[11px] space-y-0.5',
                    msg.senderRole === 'admin'
                      ? 'bg-indigo-500/15 border border-indigo-500/25 text-indigo-100'
                      : 'bg-[#121625] border border-[#232a42] text-slate-300'
                  ]"
                >
                  <div class="flex items-center justify-between text-[10px] opacity-70">
                    <span>{{ msg.senderRole === 'admin' ? '管理员回复' : '我的留言' }}</span>
                    <span>{{ msg.createdAt }}</span>
                  </div>
                  <div class="whitespace-pre-wrap break-all leading-relaxed">
                    <template v-for="(seg, idx) in splitTextWithLinks(msg.content)" :key="idx">
                      <a
                        v-if="seg.isLink"
                        :href="seg.text"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="text-amber-300 underline hover:text-amber-200"
                      >
                        {{ seg.text }}
                      </a>
                      <span v-else>{{ seg.text }}</span>
                    </template>
                  </div>
                </div>
              </div>

              <div class="flex items-center gap-1.5 pt-0.5">
                <input
                  v-model="vipReplyDrafts[req.id]"
                  type="text"
                  placeholder="回复管理员信息..."
                  @keyup.enter="sendUserVipReply(req.id)"
                  class="flex-1 px-2.5 py-1.5 rounded bg-[#121625] border border-[#272f49] text-[11px] text-white placeholder-slate-500 focus:outline-none focus:border-indigo-400"
                />
                <button
                  type="button"
                  :disabled="vipReplyBusy[req.id] || !(vipReplyDrafts[req.id] || '').trim()"
                  @click="sendUserVipReply(req.id)"
                  class="px-2.5 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                >
                  <Send class="w-3 h-3" />
                  <span>发送</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- 30-Level Roadmap -->
        <div class="space-y-2">
          <div class="text-xs font-bold text-slate-300 flex items-center justify-between">
            <span>30级成长体系路线图（约1年满级）</span>
            <span class="text-[10px] text-slate-500">每级 +3 分钟/天</span>
          </div>
          <div class="max-h-56 overflow-y-auto rounded-xl border border-[#252b41] bg-[#121522] divide-y divide-[#1e2336]">
            <div
              v-for="item in LEVEL_TABLE"
              :key="item.level"
              :class="[
                'flex items-center justify-between px-3.5 py-2 text-xs',
                item.level === userStore.levelInfo.level
                  ? 'bg-indigo-500/15 text-white font-bold'
                  : item.level < userStore.levelInfo.level
                  ? 'text-slate-300'
                  : 'text-slate-500'
              ]"
            >
              <div class="flex items-center gap-2.5">
                <span class="w-10 font-mono">Lv.{{ item.level }}</span>
                <span>{{ item.title }}</span>
                <span v-if="item.level === userStore.levelInfo.level" class="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500 text-white">当前</span>
              </div>
              <div class="flex items-center gap-4 font-mono text-[11px]">
                <span class="text-emerald-400/90">{{ item.dailyQuotaMinutes }}分钟/天</span>
                <span class="w-20 text-right">{{ item.cumulativeExp }} EXP</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Secondary Confirmation Dialog for Logout -->
    <div
      v-if="showLogoutConfirm"
      class="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4"
    >
      <div class="w-full max-w-sm bg-[#1e2336] border border-[#2f3755] rounded-xl p-5 shadow-2xl text-center space-y-4">
        <h3 class="text-base font-bold text-white">确定要退出当前账号吗？</h3>
        <p class="text-xs text-slate-400">退出后将清除本地会话，需重新登录。</p>
        <div class="flex items-center gap-3 pt-2">
          <button
            @click="showLogoutConfirm = false"
            class="flex-1 py-2 rounded-lg bg-[#2b334d] hover:bg-[#343e5c] text-sm text-slate-300 font-medium transition-colors"
          >
            取消
          </button>
          <button
            @click="handleLogout"
            class="flex-1 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-sm text-white font-medium transition-colors"
          >
            确认退出
          </button>
        </div>
      </div>
    </div>

    <!-- Avatar Selection & Cropping Modal -->
    <AvatarSelectModal v-model="showAvatarSelectModal" />
  </div>
</template>
