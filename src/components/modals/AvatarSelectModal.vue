<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { useUserStore } from '../../stores/userStore'
import { PRESET_AVATARS, type PresetAvatar } from '../../utils/presetAvatars'
import {
  X,
  Upload,
  RotateCw,
  ZoomIn,
  ZoomOut,
  Check,
  RefreshCw,
  Scissors,
  CheckCircle2,
  ArrowLeft
} from 'lucide-vue-next'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'avatar-changed', url: string): void
}>()

const userStore = useUserStore()

// View state: 'select' | 'crop'
const viewMode = ref<'select' | 'crop'>('select')

// Selected preset avatar ID (for selection highlight)
const selectedPresetId = ref<string>('')

// Custom upload & crop state
const fileInputRef = ref<HTMLInputElement | null>(null)
const cropCanvasRef = ref<HTMLCanvasElement | null>(null)
const previewCanvasRef = ref<HTMLCanvasElement | null>(null)

const sourceImage = ref<HTMLImageElement | null>(null)
const zoom = ref(1)
const rotation = ref(0)
const panX = ref(0)
const panY = ref(0)
const isDragging = ref(false)
const dragStartX = ref(0)
const dragStartY = ref(0)
const isCompressing = ref(false)
const compressedSizeKb = ref<number | null>(null)
const toastMsg = ref('')

function showToast(msg: string) {
  toastMsg.value = msg
  setTimeout(() => {
    toastMsg.value = ''
  }, 2200)
}

function closeModal() {
  emit('update:modelValue', false)
  viewMode.value = 'select'
  resetCropState()
}

// Check if current user avatar matches a preset
watch(() => props.modelValue, (isOpen) => {
  if (isOpen) {
    viewMode.value = 'select'
    const found = PRESET_AVATARS.find(p => p.url === userStore.profile.avatar)
    selectedPresetId.value = found ? found.id : ''
  }
})

// Apply preset avatar
async function handleSelectPreset(preset: PresetAvatar) {
  selectedPresetId.value = preset.id
  await userStore.updateAvatar(preset.url)
  emit('avatar-changed', preset.url)
  showToast(`已更换为「${preset.name}」头像`)
  setTimeout(() => {
    closeModal()
  }, 600)
}

// Trigger file input
function handleTriggerUpload() {
  if (fileInputRef.value) {
    fileInputRef.value.value = ''
    fileInputRef.value.click()
  }
}

// File selected
function handleFileChange(e: Event) {
  const target = e.target as HTMLInputElement
  if (!target.files || target.files.length === 0) return

  const file = target.files[0]
  if (!file.type.startsWith('image/')) {
    alert('请选择有效的图片文件 (JPG, PNG, WebP 等)')
    return
  }

  const reader = new FileReader()
  reader.onload = (event) => {
    const img = new Image()
    img.onload = () => {
      sourceImage.value = img
      viewMode.value = 'crop'
      resetCropState()
      nextTick(() => {
        initCropCanvas()
      })
    }
    img.src = event.target?.result as string
  }
  reader.readAsDataURL(file)
}

function resetCropState() {
  zoom.value = 1
  rotation.value = 0
  panX.value = 0
  panY.value = 0
  compressedSizeKb.value = null
}

function initCropCanvas() {
  if (!sourceImage.value || !cropCanvasRef.value) return
  // Base scale to fit 300x300
  zoom.value = 1
  panX.value = 0
  panY.value = 0
  rotation.value = 0
  renderCropCanvas()
}

function renderCropCanvas() {
  const canvas = cropCanvasRef.value
  const img = sourceImage.value
  if (!canvas || !img) return

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  // Strictly 300 x 300 canvas
  const C_SIZE = 300
  canvas.width = C_SIZE
  canvas.height = C_SIZE

  // Clear canvas transparently
  ctx.clearRect(0, 0, C_SIZE, C_SIZE)

  ctx.save()
  // Move to center of 300x300
  ctx.translate(C_SIZE / 2, C_SIZE / 2)
  ctx.rotate((rotation.value * Math.PI) / 180)

  // Calculate scaled dimensions: base scale makes min dimension equal to 300
  const baseScale = C_SIZE / Math.min(img.width, img.height)
  const currentScale = baseScale * zoom.value

  const drawW = img.width * currentScale
  const drawH = img.height * currentScale

  // Account for pan offset
  ctx.drawImage(img, -drawW / 2 + panX.value, -drawH / 2 + panY.value, drawW, drawH)
  ctx.restore()

  // Update preview canvas
  renderPreview()
}

function renderPreview() {
  const canvas = cropCanvasRef.value
  const preview = previewCanvasRef.value
  if (!canvas || !preview) return

  const pCtx = preview.getContext('2d')
  if (!pCtx) return

  preview.width = 80
  preview.height = 80
  pCtx.clearRect(0, 0, 80, 80)
  pCtx.drawImage(canvas, 0, 0, 80, 80)
}

// Mouse / Touch interaction for panning
function handleMouseDown(e: MouseEvent) {
  isDragging.value = true
  dragStartX.value = e.clientX - panX.value
  dragStartY.value = e.clientY - panY.value
}

function handleMouseMove(e: MouseEvent) {
  if (!isDragging.value) return
  panX.value = e.clientX - dragStartX.value
  panY.value = e.clientY - dragStartY.value
  renderCropCanvas()
}

function handleMouseUp() {
  isDragging.value = false
}

function handleWheel(e: WheelEvent) {
  e.preventDefault()
  const delta = e.deltaY < 0 ? 0.1 : -0.1
  const newZoom = Math.max(0.5, Math.min(3.5, zoom.value + delta))
  zoom.value = Math.round(newZoom * 100) / 100
  renderCropCanvas()
}

function handleRotate() {
  rotation.value = (rotation.value + 90) % 360
  renderCropCanvas()
}

function handleZoomChange() {
  renderCropCanvas()
}

// Compress and generate final avatar under 100KB
async function handleConfirmCrop() {
  const canvas = cropCanvasRef.value
  if (!canvas) return

  isCompressing.value = true

  try {
    // 1. Check transparency
    const ctx = canvas.getContext('2d')
    let hasAlpha = false
    if (ctx) {
      const imgData = ctx.getImageData(0, 0, 300, 300)
      const data = imgData.data
      for (let i = 3; i < data.length; i += 16) {
        if (data[i] < 245) {
          hasAlpha = true
          break
        }
      }
    }

    let finalDataUrl = ''
    let finalBytes = 0

    // Try PNG if transparent
    if (hasAlpha) {
      const pngUrl = canvas.toDataURL('image/png')
      const pngBytes = Math.round((pngUrl.length - 22) * 0.75)
      if (pngBytes <= 100 * 1024) {
        finalDataUrl = pngUrl
        finalBytes = pngBytes
      }
    }

    // Otherwise or if PNG > 100KB, use adaptive JPEG compression
    if (!finalDataUrl) {
      let quality = 0.92
      finalDataUrl = canvas.toDataURL('image/jpeg', quality)
      finalBytes = Math.round((finalDataUrl.length - 23) * 0.75)

      while (finalBytes > 100 * 1024 && quality > 0.15) {
        quality -= 0.08
        finalDataUrl = canvas.toDataURL('image/jpeg', quality)
        finalBytes = Math.round((finalDataUrl.length - 23) * 0.75)
      }
    }

    compressedSizeKb.value = Math.round((finalBytes / 1024) * 10) / 10

    // Persist to store & backend
    await userStore.updateAvatar(finalDataUrl)
    emit('avatar-changed', finalDataUrl)
    showToast(`裁剪完成！已压缩至 ${compressedSizeKb.value} KB (≤100KB)`)

    setTimeout(() => {
      closeModal()
    }, 800)
  } catch (err) {
    console.error('Failed to crop avatar:', err)
    alert('保存头像失败，请重试')
  } finally {
    isCompressing.value = false
  }
}
</script>

<template>
  <div
    v-if="modelValue"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 select-none"
    @click.self="closeModal"
  >
    <!-- Modal Card -->
    <div
      class="w-full max-w-xl bg-[#161a29] border border-[#272d45] rounded-2xl shadow-2xl overflow-hidden flex flex-col transition-all max-h-[90vh]"
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-[#242b41]">
        <div class="flex items-center gap-2">
          <button
            v-if="viewMode === 'crop'"
            @click="viewMode = 'select'"
            class="p-1 rounded-lg hover:bg-[#252c42] text-slate-400 hover:text-white transition-colors cursor-pointer mr-1"
            title="返回选择"
          >
            <ArrowLeft class="w-4 h-4" />
          </button>
          <Scissors v-if="viewMode === 'crop'" class="w-4 h-4 text-indigo-400" />
          <h3 class="text-sm font-bold text-white">
            {{ viewMode === 'select' ? '选择或自定义头像' : '头像裁剪 (300×300，≤100KB)' }}
          </h3>
        </div>
        <button
          @click="closeModal"
          class="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-[#23293f] transition-colors cursor-pointer"
        >
          <X class="w-5 h-5" />
        </button>
      </div>

      <!-- Toast Feedback inside modal -->
      <div
        v-if="toastMsg"
        class="mx-6 mt-3 px-3.5 py-2 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs flex items-center gap-2 animate-fade-in shrink-0"
      >
        <CheckCircle2 class="w-4 h-4 text-emerald-400" />
        <span>{{ toastMsg }}</span>
      </div>

      <!-- Hidden File Input -->
      <input
        ref="fileInputRef"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        class="hidden"
        @change="handleFileChange"
      />

      <!-- ================= View 1: Select Preset or Trigger Upload ================= -->
      <div v-if="viewMode === 'select'" class="p-6 overflow-y-auto space-y-6 flex-1">
        <!-- Top Banner: Custom Local Upload -->
        <div class="p-4 rounded-xl bg-[#1d2235] border border-[#2a324d] flex items-center justify-between gap-4">
          <div class="flex items-center gap-3">
            <div class="w-12 h-12 rounded-xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
              <Upload class="w-6 h-6" />
            </div>
            <div>
              <div class="text-xs font-bold text-slate-100">自定义本地图片</div>
              <div class="text-[11px] text-slate-400 mt-0.5">
                支持自由缩放裁剪正方形（限定 300×300 像素，自动压缩至 100K 内）
              </div>
            </div>
          </div>
          <button
            @click="handleTriggerUpload"
            class="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-all shadow-md shadow-indigo-600/30 cursor-pointer shrink-0 flex items-center gap-1.5"
          >
            <Upload class="w-3.5 h-3.5" />
            <span>选择本地图片</span>
          </button>
        </div>

        <!-- Presets Grid -->
        <div>
          <div class="flex items-center justify-between mb-3">
            <span class="text-xs font-bold text-slate-200">系统精选头像 (15款)</span>
            <span class="text-[11px] text-slate-400">点击即可即时应用</span>
          </div>

          <div class="grid grid-cols-5 gap-3">
            <button
              v-for="preset in PRESET_AVATARS"
              :key="preset.id"
              @click="handleSelectPreset(preset)"
              :class="[
                'p-2.5 rounded-xl border flex flex-col items-center gap-2 transition-all cursor-pointer group relative',
                selectedPresetId === preset.id
                  ? 'bg-indigo-600/20 border-indigo-500 ring-2 ring-indigo-500/50'
                  : 'bg-[#1a1f31] border-[#252c42] hover:bg-[#20273e] hover:border-slate-600'
              ]"
            >
              <!-- Avatar circle with transparent background handling -->
              <div
                class="user-avatar-wrap w-14 h-14 rounded-full overflow-hidden p-1 flex items-center justify-center transition-transform group-hover:scale-105"
              >
                <img
                  :src="preset.url"
                  :alt="preset.name"
                  class="user-avatar-img w-full h-full rounded-full object-cover"
                />
              </div>

              <span class="text-[11px] text-slate-300 group-hover:text-white transition-colors truncate max-w-full font-medium">
                {{ preset.name }}
              </span>

              <!-- Active Badge -->
              <div
                v-if="selectedPresetId === preset.id"
                class="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-indigo-600 text-white flex items-center justify-center shadow"
              >
                <Check class="w-2.5 h-2.5 stroke-[3]" />
              </div>
            </button>
          </div>
        </div>
      </div>

      <!-- ================= View 2: Image Cropper & Compressor ================= -->
      <div v-else class="p-6 overflow-y-auto space-y-5 flex-1">
        <!-- Crop Workspace -->
        <div class="flex flex-col md:flex-row items-center gap-6 justify-center">
          <!-- Canvas Viewport Box -->
          <div class="relative select-none flex flex-col items-center">
            <div
              class="relative w-[300px] h-[300px] rounded-2xl overflow-hidden border-2 border-indigo-500/80 shadow-xl bg-black/40 cursor-grab active:cursor-grabbing"
              @mousedown="handleMouseDown"
              @mousemove="handleMouseMove"
              @mouseup="handleMouseUp"
              @mouseleave="handleMouseUp"
              @wheel="handleWheel"
            >
              <!-- The Strict 300x300 Working Canvas -->
              <canvas
                ref="cropCanvasRef"
                class="w-[300px] h-[300px] block"
              ></canvas>

              <!-- Circle Mask Guide Overlay -->
              <div class="pointer-events-none absolute inset-0 rounded-full border border-indigo-400/40 ring-1 ring-white/20"></div>
              
              <!-- Subtle Crosshair & Grid -->
              <div class="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-25">
                <div class="border-r border-b border-white"></div>
                <div class="border-r border-b border-white"></div>
                <div class="border-b border-white"></div>
                <div class="border-r border-b border-white"></div>
                <div class="border-r border-b border-white"></div>
                <div class="border-b border-white"></div>
                <div class="border-r border-white"></div>
                <div class="border-r border-white"></div>
                <div></div>
              </div>
            </div>
            <div class="text-[11px] text-slate-400 mt-2">
              按住鼠标左键可拖动平移 | 滚动滚轮缩放
            </div>
          </div>

          <!-- Preview & Controls Panel -->
          <div class="flex-1 w-full space-y-4 max-w-xs">
            <!-- Live Previews -->
            <div class="p-3.5 rounded-xl bg-[#1d2235] border border-[#2a324d] space-y-2">
              <div class="text-xs font-semibold text-slate-200">最终效果实时预览</div>
              <div class="flex items-center gap-4 pt-1">
                <!-- Circular Preview -->
                <div class="flex flex-col items-center gap-1">
                  <div class="user-avatar-wrap w-16 h-16 rounded-full overflow-hidden ring-2 ring-indigo-500/50 p-0.5">
                    <canvas ref="previewCanvasRef" class="user-avatar-img w-full h-full rounded-full object-cover"></canvas>
                  </div>
                  <span class="text-[10px] text-slate-400">圆形头像</span>
                </div>

                <!-- Specs List -->
                <div class="text-[11px] space-y-1.5 text-slate-300">
                  <div class="flex items-center gap-1.5">
                    <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                    <span>输出分辨率：<b class="text-white">300 × 300 px</b></span>
                  </div>
                  <div class="flex items-center gap-1.5">
                    <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                    <span>压缩标准：<b class="text-white">&le; 100 KB</b></span>
                  </div>
                  <div class="flex items-center gap-1.5">
                    <span class="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
                    <span>支持透明：<b class="text-slate-300">PNG / WebP</b></span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Zoom & Rotate Controls -->
            <div class="space-y-3">
              <!-- Zoom Slider -->
              <div>
                <div class="flex items-center justify-between text-xs text-slate-300 mb-1.5">
                  <span class="flex items-center gap-1">
                    <ZoomIn class="w-3.5 h-3.5 text-indigo-400" />
                    <span>缩放比例</span>
                  </span>
                  <span class="font-mono text-indigo-300 font-semibold">{{ Math.round(zoom * 100) }}%</span>
                </div>
                <div class="flex items-center gap-2">
                  <button
                    @click="zoom = Math.max(0.5, Math.round((zoom - 0.1) * 10) / 10); handleZoomChange()"
                    class="p-1 rounded bg-[#252b41] hover:bg-[#323a59] text-slate-300 cursor-pointer"
                  >
                    <ZoomOut class="w-3.5 h-3.5" />
                  </button>
                  <input
                    type="range"
                    min="0.5"
                    max="3"
                    step="0.05"
                    v-model.number="zoom"
                    @input="handleZoomChange"
                    class="w-full accent-indigo-500 cursor-pointer"
                  />
                  <button
                    @click="zoom = Math.min(3.5, Math.round((zoom + 0.1) * 10) / 10); handleZoomChange()"
                    class="p-1 rounded bg-[#252b41] hover:bg-[#323a59] text-slate-300 cursor-pointer"
                  >
                    <ZoomIn class="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <!-- Rotate & Reset Buttons -->
              <div class="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  @click="handleRotate"
                  class="flex-1 py-1.5 px-3 rounded-lg bg-[#252b41] hover:bg-[#323a59] text-xs font-medium text-slate-200 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <RotateCw class="w-3.5 h-3.5 text-amber-400" />
                  <span>顺时针旋转 90°</span>
                </button>
                <button
                  type="button"
                  @click="initCropCanvas"
                  class="py-1.5 px-3 rounded-lg bg-[#252b41] hover:bg-[#323a59] text-xs font-medium text-slate-300 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  title="重置居中"
                >
                  <RefreshCw class="w-3.5 h-3.5" />
                  <span>复位</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Crop Modal Bottom Action Bar -->
        <div class="pt-4 border-t border-[#252b41] flex items-center justify-between gap-3">
          <button
            @click="handleTriggerUpload"
            class="px-3.5 py-2 rounded-xl bg-[#252b41] hover:bg-[#323a59] text-xs font-medium text-slate-300 transition-colors cursor-pointer"
          >
            重新选图
          </button>

          <div class="flex items-center gap-3">
            <button
              @click="viewMode = 'select'"
              class="px-4 py-2 rounded-xl bg-[#252b41] hover:bg-[#323a59] text-xs font-medium text-slate-300 transition-colors cursor-pointer"
            >
              取消
            </button>
            <button
              @click="handleConfirmCrop"
              :disabled="isCompressing"
              class="px-6 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold transition-all shadow-md shadow-indigo-600/30 cursor-pointer flex items-center gap-2"
            >
              <Check class="w-4 h-4" />
              <span>{{ isCompressing ? '压缩并应用中...' : '确认裁剪并保存' }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
