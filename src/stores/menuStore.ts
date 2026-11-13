import { defineStore } from 'pinia'
import type { MenuItemConfig } from '../types'

const DEFAULT_MENU_ITEMS: MenuItemConfig[] = [
  { id: 'home', label: '首页', iconName: 'Home', path: '/', order: 1, isEnabled: true, isSystemDefault: true },
  { id: 'favorites', label: '我的收藏', iconName: 'Star', path: '/favorites', order: 2, isEnabled: true, isSystemDefault: false },
  { id: 'courses', label: '课程广场', iconName: 'LayoutGrid', path: '/courses', order: 3, isEnabled: true, isSystemDefault: false },
  { id: 'teaching', label: '教辅广场', iconName: 'BookOpen', path: '/teaching', order: 4, isEnabled: true, isSystemDefault: false },
  { id: 'review', label: '复习本', iconName: 'FileEdit', path: '/review', order: 5, isEnabled: true, isSystemDefault: false },
  { id: 'settings', label: '设置', iconName: 'Settings', path: '/settings', order: 6, isEnabled: true, isSystemDefault: false },
]

export const useMenuStore = defineStore('menu', {
  state: () => {
    let items = DEFAULT_MENU_ITEMS
    try {
      const saved = localStorage.getItem('tqd_menu_items')
      if (saved) items = JSON.parse(saved)
    } catch {
      // Ignored
    }
    return {
      menuItems: items,
      activeMenuId: 'home',
    }
  },
  getters: {
    visibleMenuItems(state): MenuItemConfig[] {
      return [...state.menuItems]
        .filter(m => m.isEnabled)
        .sort((a, b) => a.order - b.order)
    },
  },
  actions: {
    async fetchMenu() {
      try {
        const res = await fetch('/api/user/menu')
        if (res.ok) {
          const data = await res.json()
          if (Array.isArray(data) && data.length > 0) {
            this.menuItems = data
            try {
              localStorage.setItem('tqd_menu_items', JSON.stringify(data))
            } catch {}
          }
        }
      } catch (err) {
        console.error('Failed to fetch menu configuration:', err)
      }
    },
    async save() {
      try {
        localStorage.setItem('tqd_menu_items', JSON.stringify(this.menuItems))
      } catch {
        // Ignored
      }
      try {
        await fetch('/api/user/menu', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.menuItems),
        })
      } catch (err) {
        console.error('Failed to persist menu to DB:', err)
      }
    },
    updateItem(id: string, updates: Partial<MenuItemConfig>) {
      const item = this.menuItems.find(m => m.id === id)
      if (item) {
        // Home cannot be disabled
        if (item.id === 'home' && updates.isEnabled === false) {
          return
        }
        Object.assign(item, updates)
        this.save()
      }
    },
    moveUp(index: number) {
      if (index > 0) {
        const itemA = this.menuItems[index]
        const itemB = this.menuItems[index - 1]
        if (itemA && itemB) {
          const tempOrder = itemA.order
          itemA.order = itemB.order
          itemB.order = tempOrder
          this.menuItems.sort((a, b) => a.order - b.order)
          this.save()
        }
      }
    },
    moveDown(index: number) {
      if (index < this.menuItems.length - 1) {
        const itemA = this.menuItems[index]
        const itemB = this.menuItems[index + 1]
        if (itemA && itemB) {
          const tempOrder = itemA.order
          itemA.order = itemB.order
          itemB.order = tempOrder
          this.menuItems.sort((a, b) => a.order - b.order)
          this.save()
        }
      }
    },
  },
})
