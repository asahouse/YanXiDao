<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { ChevronDown, Check } from 'lucide-vue-next'

export interface SelectOption {
  label: string
  value: any
  subtext?: string
  disabled?: boolean
}

const props = withDefaults(
  defineProps<{
    modelValue: any
    options: (SelectOption | string | number)[]
    placeholder?: string
    disabled?: boolean
    size?: 'sm' | 'md'
  }>(),
  {
    placeholder: '请选择...',
    disabled: false,
    size: 'md',
  }
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: any): void
  (e: 'change', value: any): void
}>()

const isOpen = ref(false)
const selectRef = ref<HTMLElement | null>(null)

// Normalize options to SelectOption objects
const normalizedOptions = computed<SelectOption[]>(() => {
  return props.options.map((opt) => {
    if (typeof opt === 'object' && opt !== null && 'label' in opt && 'value' in opt) {
      return opt as SelectOption
    }
    return {
      label: String(opt),
      value: opt,
    }
  })
})

const selectedOption = computed(() => {
  return normalizedOptions.value.find((opt) => opt.value === props.modelValue)
})

const displayLabel = computed(() => {
  if (selectedOption.value) return selectedOption.value.label
  if (props.modelValue !== undefined && props.modelValue !== null && props.modelValue !== '') {
    return String(props.modelValue)
  }
  return props.placeholder
})

function toggleDropdown() {
  if (props.disabled) return
  isOpen.value = !isOpen.value
}

function selectOption(option: SelectOption) {
  if (option.disabled) return
  emit('update:modelValue', option.value)
  emit('change', option.value)
  isOpen.value = false
}

function handleClickOutside(e: MouseEvent) {
  if (selectRef.value && !selectRef.value.contains(e.target as Node)) {
    isOpen.value = false
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && isOpen.value) {
    isOpen.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div ref="selectRef" class="custom-select-wrapper relative w-full select-none text-xs">
    <!-- Trigger Button -->
    <button
      type="button"
      @click="toggleDropdown"
      :disabled="disabled"
      :class="[
        'custom-select-trigger w-full flex items-center justify-between gap-2 rounded-xl transition-all cursor-pointer text-left outline-none font-medium',
        size === 'sm' ? 'px-2.5 py-1.5 text-[11px]' : 'px-3 py-2 text-xs',
        isOpen ? 'ring-2 ring-indigo-500/50 border-indigo-500' : '',
        disabled ? 'opacity-50 cursor-not-allowed' : ''
      ]"
    >
      <span class="truncate" :class="!selectedOption ? 'text-slate-400' : ''">
        {{ displayLabel }}
      </span>

      <ChevronDown
        class="w-4 h-4 shrink-0 transition-transform duration-200"
        :class="[
          isOpen ? 'rotate-180 text-indigo-500' : 'text-slate-400',
          size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'
        ]"
      />
    </button>

    <!-- Floating Options Menu -->
    <transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="transform scale-95 opacity-0 -translate-y-1"
      enter-to-class="transform scale-100 opacity-100 translate-y-0"
      leave-active-class="transition duration-100 ease-in"
      leave-from-class="transform scale-100 opacity-100 translate-y-0"
      leave-to-class="transform scale-95 opacity-0 -translate-y-1"
    >
      <div
        v-if="isOpen"
        class="custom-select-menu absolute left-0 right-0 z-50 mt-1.5 rounded-xl border p-1 shadow-2xl backdrop-blur-md max-h-60 overflow-y-auto space-y-0.5"
      >
        <div
          v-for="opt in normalizedOptions"
          :key="String(opt.value)"
          @click="selectOption(opt)"
          :class="[
            'custom-select-option px-3 py-2 rounded-lg flex items-center justify-between gap-2 cursor-pointer transition-colors',
            opt.disabled ? 'opacity-40 cursor-not-allowed' : '',
            opt.value === modelValue
              ? 'is-selected font-semibold'
              : 'is-unselected'
          ]"
        >
          <div class="flex flex-col truncate">
            <span class="truncate">{{ opt.label }}</span>
            <span v-if="opt.subtext" class="text-[10px] text-slate-400 font-mono">{{ opt.subtext }}</span>
          </div>

          <Check
            v-if="opt.value === modelValue"
            class="w-3.5 h-3.5 shrink-0 text-indigo-500"
          />
        </div>
      </div>
    </transition>
  </div>
</template>
