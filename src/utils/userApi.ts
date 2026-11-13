export const USER_TOKEN_KEY = 'yxd_user_token'

export function getUserToken(): string {
  return localStorage.getItem(USER_TOKEN_KEY) || ''
}

export function getUserAuthHeaders(extraHeaders: Record<string, string> = {}): Record<string, string> {
  const token = getUserToken()
  const headers: Record<string, string> = { ...extraHeaders }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  return headers
}

export async function userFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {})
  const token = getUserToken()
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  return fetch(input, { ...init, headers })
}
