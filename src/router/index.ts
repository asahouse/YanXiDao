import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('../views/LoginView.vue'),
      meta: { standaloneLayout: true },
    },
    {
      path: '/change-password',
      name: 'change-password',
      component: () => import('../views/ChangePasswordView.vue'),
      meta: { standaloneLayout: true },
    },
    {
      path: '/',
      name: 'home',
      component: HomeView,
    },
    {
      path: '/favorites',
      name: 'favorites',
      component: () => import('../views/FavoritesView.vue'),
    },
    {
      path: '/courses',
      name: 'courses',
      component: () => import('../views/CoursesView.vue'),
    },
    {
      path: '/teaching',
      name: 'teaching',
      component: () => import('../views/TeachingView.vue'),
    },
    {
      path: '/course/:id',
      name: 'course-detail',
      component: () => import('../views/CourseDetailView.vue'),
    },
    {
      path: '/practice/:courseId/:lessonId',
      name: 'practice',
      component: () => import('../views/PracticeView.vue'),
    },
    {
      path: '/review',
      name: 'review',
      component: () => import('../views/ReviewView.vue'),
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('../views/SettingsView.vue'),
    },
  ],
})

export default router
