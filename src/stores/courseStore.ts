import { defineStore } from 'pinia'
import type { CourseItem, LessonItem, CourseCategoryItem } from '../types'
import { userFetch } from '../utils/userApi'

export const useCourseStore = defineStore('course', {
  state: () => ({
    courses: [] as CourseItem[],
    teachingMaterials: [] as CourseItem[],
    categories: [] as CourseCategoryItem[],
    lessons: [] as LessonItem[],
    currentCourse: null as CourseItem | null,
    currentLesson: null as LessonItem | null,
    isLoading: false,
  }),
  actions: {
    async fetchCourses(_userId: string = '8723192') {
      try {
        this.isLoading = true
        const res = await userFetch(`/api/courses`)
        if (res.ok) {
          const data: CourseItem[] = await res.json()
          this.courses = data.filter(c => c.type === 'course')
          this.teachingMaterials = data.filter(c => c.type === 'teaching')
        }
      } catch (err) {
        console.error('Failed to fetch courses:', err)
      } finally {
        this.isLoading = false
      }
    },

    async fetchCourseDetails(courseId: string, _userId: string = '8723192') {
      try {
        const res = await userFetch(`/api/courses/${courseId}`)
        if (res.ok) {
          const data = await res.json()
          this.currentCourse = data.course
          this.categories = data.categories || []
          // Update lessons in store
          const existingOtherLessons = this.lessons.filter(l => l.courseId !== courseId)
          this.lessons = [...existingOtherLessons, ...(data.lessons || [])]
          return data
        }
      } catch (err) {
        console.error('Failed to fetch course details:', err)
      }
      return null
    },

    async fetchLesson(lessonId: string): Promise<LessonItem | null> {
      try {
        const res = await fetch(`/api/lessons/${lessonId}`)
        if (res.ok) {
          const lesson: LessonItem = await res.json()
          const idx = this.lessons.findIndex(l => l.id === lessonId)
          if (idx >= 0) {
            this.lessons[idx] = lesson
          } else {
            this.lessons.push(lesson)
          }
          this.currentLesson = lesson
          return lesson
        }
      } catch (err) {
        console.error('Failed to fetch lesson:', err)
      }
      return this.lessons.find(l => l.id === lessonId) || null
    },

    async toggleFavorite(courseId: string, userId: string = '8723192'): Promise<boolean> {
      const course = this.courses.find(c => c.id === courseId) || this.teachingMaterials.find(t => t.id === courseId)
      // Optimistic update
      if (course) {
        course.isFavorite = !course.isFavorite
      }
      if (this.currentCourse && this.currentCourse.id === courseId) {
        this.currentCourse.isFavorite = !this.currentCourse.isFavorite
      }
      try {
        const res = await userFetch(`/api/courses/${courseId}/favorite`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId }),
        })
        if (res.ok) {
          const data = await res.json()
          if (typeof data.isFavorite === 'boolean') {
            if (course) course.isFavorite = data.isFavorite
            if (this.currentCourse && this.currentCourse.id === courseId) {
              this.currentCourse.isFavorite = data.isFavorite
            }
            return data.isFavorite
          }
        }
      } catch (err) {
        console.error('Failed to toggle favorite:', err)
      }
      return course ? course.isFavorite : false
    },

    async fetchCategories(courseId: string): Promise<CourseCategoryItem[]> {
      const res = await fetch(`/api/courses/${courseId}/categories`)
      if (res.ok) {
        const data = await res.json()
        this.categories = data
        return data
      }
      return []
    },

    async fetchCourseLessons(courseId: string): Promise<LessonItem[]> {
      try {
        const res = await fetch(`/api/courses/${courseId}/lessons`)
        if (res.ok) {
          const data: LessonItem[] = await res.json()
          return data
        }
      } catch (err) {
        console.error('Failed to fetch course lessons:', err)
      }
      return []
    },

    async fetchCategoryLessons(categoryId: string): Promise<LessonItem[]> {
      try {
        const res = await fetch(`/api/categories/${categoryId}/lessons`)
        if (res.ok) {
          const data: LessonItem[] = await res.json()
          return data
        }
      } catch (err) {
        console.error('Failed to fetch category lessons:', err)
      }
      return []
    },

    async completeLesson(lessonId: string, durationSeconds = 60) {
      const lesson = this.lessons.find(l => l.id === lessonId)
      if (lesson) {
        lesson.completedCount += 1
      }
      try {
        await userFetch(`/api/lessons/${lessonId}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ durationSeconds }),
        })
      } catch (err) {
        console.error('Failed to mark lesson complete:', err)
      }
    },

    getCourseById(courseId: string) {
      return this.courses.find(c => c.id === courseId) || this.teachingMaterials.find(t => t.id === courseId)
    },

    getLessonsByCourseId(courseId: string) {
      return this.lessons.filter(l => l.courseId === courseId)
    },

    getLessonById(lessonId: string) {
      return this.lessons.find(l => l.id === lessonId)
    },
  },
})
