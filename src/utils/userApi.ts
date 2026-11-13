export const USER_TOKEN_KEY = 'yxd_user_token'

export type ClientType = 'web' | 'desktop'

export function getClientType(): ClientType {
  if (typeof window !== 'undefined') {
    const ua = navigator.userAgent || ''
    if (/Electron/i.test(ua) || window.location.protocol === 'file:' || Boolean((window as any).electronAPI)) {
      return 'desktop'
    }
  }
  return 'web'
}

export function getUserToken(): string {
  return localStorage.getItem(USER_TOKEN_KEY) || ''
}

export function getUserAuthHeaders(extraHeaders: Record<string, string> = {}): Record<string, string> {
  const token = getUserToken()
  const headers: Record<string, string> = {
    'X-Client-Type': getClientType(),
    ...extraHeaders,
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  return headers
}

export async function userFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {})
  const token = getUserToken()
  if (!headers.has('X-Client-Type')) {
    headers.set('X-Client-Type', getClientType())
  }
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const res = await fetch(input, { ...init, headers })
  if (res.status === 401 && token && typeof window !== 'undefined') {
    try {
      const cloned = res.clone()
      const data = await cloned.json()
      if (data?.code === 'SESSION_KICKED' || data?.code === 'SESSION_EXPIRED') {
        localStorage.removeItem(USER_TOKEN_KEY)
        window.dispatchEvent(new CustomEvent('yxd:session-kicked', { detail: data.error || '登录会话已失效，请重新登录' }))
      }
    } catch {}
  }
  return res
}
