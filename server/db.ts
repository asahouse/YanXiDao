import { DatabaseSync } from 'node:sqlite'
import mysql from 'mysql2/promise'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashPassword } from './authUtils'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '..')

// Allow Electron or environment variable to specify writable user data directory
const DATA_DIR = process.env.YANXIDAO_DATA_DIR || path.join(PROJECT_ROOT, 'data')
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

export const DB_FILE_PATH = process.env.YANXIDAO_DB_PATH || path.join(DATA_DIR, 'yanxidao.db')
export const SNAPSHOT_FILE_PATH = path.join(__dirname, 'builtin-snapshot.json')

export const DB_MODE: 'mysql' | 'sqlite' =
  process.env.DB_TYPE?.toLowerCase() === 'mysql' || Boolean(process.env.DB_HOST || process.env.MYSQL_HOST)
    ? 'mysql'
    : 'sqlite'

const MYSQL_CONFIG = {
  host: process.env.DB_HOST || process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || process.env.MYSQL_PORT || 3306),
  user: process.env.DB_USER || process.env.MYSQL_USER || 'root',
  password: process.env.DB_PASSWORD ?? process.env.MYSQL_PASSWORD ?? '',
  database: process.env.DB_NAME || process.env.MYSQL_DATABASE || 'yanxidao',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
}

let mysqlPool: mysql.Pool | null = null

// Open native SQLite database only in sqlite mode
export const sqliteDb: DatabaseSync =
  DB_MODE === 'sqlite'
    ? (() => {
        const db = new DatabaseSync(DB_FILE_PATH)
        db.exec('PRAGMA journal_mode = WAL;')
        db.exec('PRAGMA synchronous = NORMAL;')
        db.exec('PRAGMA foreign_keys = OFF;')
        return db
      })()
    : (null as unknown as DatabaseSync)

async function getMysqlPool(): Promise<mysql.Pool> {
  if (mysqlPool) return mysqlPool
  if (process.env.DB_AUTO_CREATE !== 'false') {
    const bootstrapConn = await mysql.createConnection({
      host: MYSQL_CONFIG.host,
      port: MYSQL_CONFIG.port,
      user: MYSQL_CONFIG.user,
      password: MYSQL_CONFIG.password,
      charset: 'utf8mb4',
    })
    await bootstrapConn.query(
      `CREATE DATABASE IF NOT EXISTS \`${MYSQL_CONFIG.database.replace(/`/g, '')}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
    )
    await bootstrapConn.end()
  }
  mysqlPool = mysql.createPool(MYSQL_CONFIG)
  return mysqlPool
}

/**
 * Normalize MySQL-dialect SQL queries and parameters into SQLite-compatible SQL & parameter list
 */
function normalizeSqlAndParams(rawSql: string, rawParams: any[] = []): { sql: string; params: any[] } {
  let sql = rawSql.trim()

  // 1. Expand array parameters for IN (?) clauses
  const finalParams: any[] = []
  if (rawParams && rawParams.length > 0) {
    let paramIdx = 0
    sql = sql.replace(/\?/g, () => {
      const val = rawParams[paramIdx++]
      if (Array.isArray(val)) {
        if (val.length === 0) {
          finalParams.push(null)
          return '?'
        }
        for (const item of val) {
          finalParams.push(typeof item === 'boolean' ? (item ? 1 : 0) : (item === undefined ? null : item))
        }
        return val.map(() => '?').join(', ')
      } else {
        finalParams.push(typeof val === 'boolean' ? (val ? 1 : 0) : (val === undefined ? null : val))
        return '?'
      }
    })
  }

  // 2. Strip MySQL table options
  sql = sql.replace(/\)\s*ENGINE\s*=\s*InnoDB[^;]*/gi, ')')

  // 3. Convert MySQL functions to SQLite equivalents
  sql = sql.replace(/\bNOW\(\)/gi, "datetime('now', 'localtime')")
  sql = sql.replace(/\bGREATEST\s*\(/gi, 'MAX(')
  sql = sql.replace(/\bRAND\(\)/gi, 'RANDOM()')
  sql = sql.replace(/\bINSERT\s+IGNORE\s+INTO\b/gi, 'INSERT OR IGNORE INTO')

  // 4. Convert ON DUPLICATE KEY UPDATE -> ON CONFLICT DO UPDATE SET and VALUES(col) -> excluded.col
  if (/ON\s+DUPLICATE\s+KEY\s+UPDATE/i.test(sql)) {
    sql = sql.replace(/ON\s+DUPLICATE\s+KEY\s+UPDATE/gi, 'ON CONFLICT DO UPDATE SET')
    sql = sql.replace(/VALUES\s*\(\s*([a-zA-Z0-9_]+)\s*\)/gi, 'excluded.$1')
  }

  return { sql, params: finalParams }
}

let inTransaction = false

async function executeQuery<T = any>(rawSql: string, rawParams: any[] = []): Promise<[T, any]> {
  const trimmed = rawSql.trim()

  // Handle MySQL SHOW COLUMNS FROM <table> LIKE '<col>'
  const showColsMatch = trimmed.match(/^SHOW\s+COLUMNS\s+FROM\s+([a-zA-Z0-9_]+)\s+LIKE\s+'([^']+)'/i)
  if (showColsMatch) {
    const tableName = showColsMatch[1]
    const colName = showColsMatch[2]
    const cols = sqliteDb.prepare(`PRAGMA table_info(${tableName});`).all() as any[]
    const matched = cols.filter(c => c.name === colName)
    return [matched as unknown as T, []]
  }

  // Handle MySQL SHOW TABLES
  if (/^SHOW\s+TABLES/i.test(trimmed)) {
    const tables = sqliteDb
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")
      .all() as any[]
    return [tables as unknown as T, []]
  }

  const { sql, params } = normalizeSqlAndParams(trimmed, rawParams)
  const isSelect = /^\s*(SELECT|PRAGMA|WITH)\b/i.test(sql)

  if (isSelect) {
    const stmt = sqliteDb.prepare(sql)
    const rows = stmt.all(...params)
    return [rows as unknown as T, []]
  } else {
    const stmt = sqliteDb.prepare(sql)
    const result = stmt.run(...params)
    const header = {
      affectedRows: Number(result.changes || 0),
      insertId: Number(result.lastInsertRowid || 0),
    }
    return [header as unknown as T, []]
  }
}

/**
 * mysql2/promise compatible pool wrapper backed by embedded SQLite
 */
export const pool = {
  async query<T = any>(sql: string, params?: any[]): Promise<[T, any]> {
    if (DB_MODE === 'mysql') {
      const mp = await getMysqlPool()
      return mp.query(sql, params || []) as unknown as Promise<[T, any]>
    }
    return executeQuery<T>(sql, params || [])
  },
  async getConnection() {
    if (DB_MODE === 'mysql') {
      const mp = await getMysqlPool()
      return mp.getConnection()
    }
    return {
      async query<T = any>(sql: string, params?: any[]): Promise<[T, any]> {
        return executeQuery<T>(sql, params || [])
      },
      async beginTransaction() {
        if (!inTransaction) {
          sqliteDb.exec('BEGIN IMMEDIATE;')
          inTransaction = true
        }
      },
      async commit() {
        if (inTransaction) {
          sqliteDb.exec('COMMIT;')
          inTransaction = false
        }
      },
      async rollback() {
        if (inTransaction) {
          try {
            sqliteDb.exec('ROLLBACK;')
          } catch {}
          inTransaction = false
        }
      },
      release() {
        // No-op for embedded SQLite connection
      },
    }
  },
  async close() {
    try {
      if (DB_MODE === 'mysql') {
        if (mysqlPool) await mysqlPool.end()
        console.log('MySQL pool closed cleanly.')
      } else {
        if (inTransaction) {
          sqliteDb.exec('ROLLBACK;')
          inTransaction = false
        }
        sqliteDb.close()
        console.log('SQLite database connection closed cleanly.')
      }
    } catch (err) {
      console.error('Error closing database:', err)
    }
  },
}

/**
 * Execute DDL statements across SQLite and MySQL
 */
async function execDdl(rawDdl: string) {
  if (DB_MODE === 'sqlite') {
    sqliteDb.exec(rawDdl)
    return
  }
  const mp = await getMysqlPool()
  const statements = rawDdl
    .split(';')
    .map(s => s.trim())
    .filter(Boolean)

  for (let stmt of statements) {
    if (/^CREATE\s+INDEX\b/i.test(stmt)) {
      const m = stmt.match(/^CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+([a-zA-Z0-9_]+)\s+ON\s+([a-zA-Z0-9_]+)\s*\(([^)]+)\)/i)
      if (m) {
        try {
          await mp.query(`CREATE INDEX ${m[1]} ON ${m[2]} (${m[3]});`)
        } catch (err: any) {
          if (err?.code !== 'ER_DUP_KEYNAME') throw err
        }
      }
      continue
    }

    stmt = stmt
      .replace(/\b(id|meta_key|username|cat_key|level_key|word)\s+TEXT\s+PRIMARY\s+KEY/gi, '$1 VARCHAR(191) PRIMARY KEY')
      .replace(/\b(username|cat_key|level_key|word)\s+TEXT\s+NOT\s+NULL\s+UNIQUE/gi, '$1 VARCHAR(191) NOT NULL UNIQUE')
      .replace(/\b(user_id|course_id|lesson_id|sentence_id|level_key)\s+TEXT\b/gi, '$1 VARCHAR(191)')
      .replace(/\bDEFAULT\s+\(datetime\('now',\s*'localtime'\)\)/gi, 'DEFAULT CURRENT_TIMESTAMP')
      .replace(/\b(created_at|updated_at|last_practiced_at)\s+TEXT\s+DEFAULT\s+CURRENT_TIMESTAMP/gi, '$1 DATETIME DEFAULT CURRENT_TIMESTAMP')
      .replace(/\bINTEGER\b/gi, 'INT')
      .replace(/\bREAL\b/gi, 'DOUBLE')

    if (/^CREATE\s+TABLE\b/i.test(stmt) && !/ENGINE\s*=/i.test(stmt)) {
      stmt = `${stmt} ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    }
    await mp.query(stmt + ';')
  }
}

/**
 * System metadata helpers (content_version, last_sync_at, remote_sync_url)
 */
export async function getSystemMeta(key: string, defaultValue = ''): Promise<string> {
  try {
    const [rows] = await pool.query<any[]>('SELECT meta_value FROM system_meta WHERE meta_key = ? LIMIT 1;', [key])
    return rows?.[0]?.meta_value ?? defaultValue
  } catch {
    return defaultValue
  }
}

export async function setSystemMeta(key: string, value: string): Promise<void> {
  await pool.query(
    `INSERT INTO system_meta (meta_key, meta_value, updated_at)
     VALUES (?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       meta_value = VALUES(meta_value),
       updated_at = NOW();`,
    [key, value]
  )
}

/**
 * Export public course content & dictionary as a portable .yxdpack JSON bundle
 * Does NOT include any personal user data (profiles, progress, favorites, reviews)
 */
export async function exportCourseBundle(options?: { courseIds?: string[] }) {
  const courseIds = options?.courseIds?.filter(Boolean)
  let courses: any[] = []
  let courseCategories: any[] = []
  let lessons: any[] = []
  let sentences: any[] = []
  let words: any[] = []

  if (courseIds && courseIds.length > 0) {
    const [cRows] = await pool.query<any[]>('SELECT * FROM courses WHERE id IN (?) ORDER BY order_num ASC;', [courseIds])
    const [ccRows] = await pool.query<any[]>('SELECT * FROM course_categories WHERE course_id IN (?) ORDER BY order_num ASC;', [courseIds])
    const [lRows] = await pool.query<any[]>('SELECT * FROM lessons WHERE course_id IN (?) ORDER BY course_id, lesson_number ASC;', [courseIds])
    courses = cRows
    courseCategories = ccRows
    lessons = lRows
  } else {
    const [cRows] = await pool.query<any[]>('SELECT * FROM courses ORDER BY order_num ASC, created_at ASC;')
    const [ccRows] = await pool.query<any[]>('SELECT * FROM course_categories ORDER BY course_id, order_num ASC;')
    const [lRows] = await pool.query<any[]>('SELECT * FROM lessons ORDER BY course_id, lesson_number ASC;')
    courses = cRows
    courseCategories = ccRows
    lessons = lRows
  }

  const lessonIds = lessons.map(l => l.id)
  if (lessonIds.length > 0) {
    const [sRows] = await pool.query<any[]>('SELECT * FROM sentences WHERE lesson_id IN (?) ORDER BY lesson_id, sentence_index ASC;', [lessonIds])
    sentences = sRows
  }

  const sentenceIds = sentences.map(s => s.id)
  if (sentenceIds.length > 0) {
    const [wRows] = await pool.query<any[]>('SELECT * FROM words WHERE sentence_id IN (?) ORDER BY sentence_id, word_index ASC;', [sentenceIds])
    words = wRows
  }

  const [categoryCourses] = await pool.query<any[]>('SELECT * FROM category_courses ORDER BY order_num ASC;')
  const [categorySchoolLevels] = await pool.query<any[]>('SELECT * FROM category_school_levels ORDER BY order_num ASC;')
  const [categoryGrades] = await pool.query<any[]>('SELECT * FROM category_grades ORDER BY level_key, order_num ASC;')
  const [ttsDictionary] = await pool.query<any[]>('SELECT * FROM tts_dictionary ORDER BY created_at DESC;')

  // Strip user-specific runtime fields when exporting public course bundle
  const sanitizedCourses = courses.map(c => ({
    ...c,
    completed_lessons: 0,
    is_favorite: 0,
  }))
  const sanitizedLessons = lessons.map(l => ({
    ...l,
    completed_count: 0,
    is_recent: 0,
  }))

  const now = new Date()
  const versionStr = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}.${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`

  return {
    format: 'yanxidao-course-bundle-v1',
    appName: '研习岛 (YanXiDao)',
    contentVersion: versionStr,
    exportedAt: now.toISOString(),
    summary: {
      coursesCount: sanitizedCourses.filter(c => c.type === 'course').length,
      teachingCount: sanitizedCourses.filter(c => c.type === 'teaching').length,
      totalCoursesCount: sanitizedCourses.length,
      lessonsCount: sanitizedLessons.length,
      sentencesCount: sentences.length,
      wordsCount: words.length,
      ttsDictCount: ttsDictionary.length,
    },
    data: {
      courses: sanitizedCourses,
      courseCategories,
      lessons: sanitizedLessons,
      sentences,
      words,
      categoryCourses,
      categorySchoolLevels,
      categoryGrades,
      ttsDictionary,
    },
  }
}

/**
 * Transactionally import/upsert a course bundle (.yxdpack) into SQLite or MySQL
 * Leaves all user personal data (user_profile, user_course_progress, reviews, favorites) 100% untouched!
 */
export async function importCourseBundle(bundle: any, options?: { updateBuiltinSnapshot?: boolean }) {
  if (!bundle || typeof bundle !== 'object') {
    throw new Error('无效的课程更新包格式：文件内容为空或不是有效的 JSON 对象')
  }

  const data = bundle.data || bundle.tables
  if (!data || !Array.isArray(data.courses)) {
    throw new Error('无效的课程更新包格式：缺少核心课程数据 (courses)')
  }

  const courses: any[] = data.courses || []
  const courseCategories: any[] = data.courseCategories || data.course_categories || []
  const lessons: any[] = data.lessons || []
  const sentences: any[] = data.sentences || []
  const words: any[] = data.words || []
  const categoryCourses: any[] = data.categoryCourses || data.category_courses || []
  const categorySchoolLevels: any[] = data.categorySchoolLevels || data.category_school_levels || []
  const categoryGrades: any[] = data.categoryGrades || data.category_grades || []
  const ttsDictionary: any[] = data.ttsDictionary || data.tts_dictionary || []

  const conn = await pool.getConnection()
  await conn.beginTransaction()
  try {
    // 1. Upsert Course Categories (Levels)
    for (const c of categoryCourses) {
      await conn.query(
        `INSERT INTO category_courses (id, cat_key, name, order_num, is_enabled)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           name = VALUES(name),
           order_num = VALUES(order_num),
           is_enabled = VALUES(is_enabled),
           updated_at = NOW();`,
        [c.id, c.cat_key || c.catKey, c.name, Number(c.order_num ?? c.orderNum ?? 99), c.is_enabled !== undefined ? (c.is_enabled ? 1 : 0) : 1]
      )
    }

    // 2. Upsert School Levels
    for (const l of categorySchoolLevels) {
      await conn.query(
        `INSERT INTO category_school_levels (id, level_key, name, order_num, is_enabled)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           name = VALUES(name),
           order_num = VALUES(order_num),
           is_enabled = VALUES(is_enabled),
           updated_at = NOW();`,
        [l.id, l.level_key || l.levelKey, l.name, Number(l.order_num ?? l.orderNum ?? 99), l.is_enabled !== undefined ? (l.is_enabled ? 1 : 0) : 1]
      )
    }

    // 3. Upsert Grades
    for (const g of categoryGrades) {
      await conn.query(
        `INSERT INTO category_grades (id, level_key, grade_value, name, order_num, is_enabled)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           level_key = VALUES(level_key),
           grade_value = VALUES(grade_value),
           name = VALUES(name),
           order_num = VALUES(order_num),
           is_enabled = VALUES(is_enabled),
           updated_at = NOW();`,
        [g.id, g.level_key || g.levelKey, Number(g.grade_value ?? g.gradeValue ?? 1), g.name, Number(g.order_num ?? g.orderNum ?? 99), g.is_enabled !== undefined ? (g.is_enabled ? 1 : 0) : 1]
      )
    }

    // 4. Upsert TTS Dictionary
    for (const d of ttsDictionary) {
      if (d.word) {
        await conn.query(
          `INSERT INTO tts_dictionary (id, word, spoken_alias, ipa)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             spoken_alias = VALUES(spoken_alias),
             ipa = VALUES(ipa);`,
          [d.id || `dict_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, d.word, d.spoken_alias ?? d.spokenAlias ?? '', d.ipa ?? '']
        )
      }
    }

    // 5. Upsert Courses (preserve existing completed_lessons)
    for (const c of courses) {
      await conn.query(
        `INSERT INTO courses (id, type, title, instructor_name, instructor_avatar, lesson_count, completed_lessons, cover, category, school_level, grade, order_num, is_favorite)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           type = VALUES(type),
           title = VALUES(title),
           instructor_name = VALUES(instructor_name),
           instructor_avatar = VALUES(instructor_avatar),
           lesson_count = VALUES(lesson_count),
           cover = VALUES(cover),
           category = VALUES(category),
           school_level = VALUES(school_level),
           grade = VALUES(grade),
           order_num = VALUES(order_num);`,
        [
          c.id,
          c.type || 'course',
          c.title,
          c.instructor_name || c.instructor?.name || '研习岛名师',
          c.instructor_avatar || c.instructor?.avatar || '',
          Number(c.lesson_count ?? c.lessonCount ?? 0),
          Number(c.completed_lessons ?? 0),
          c.cover || '',
          c.category || 'all',
          c.school_level || c.schoolLevel || 'all',
          Number(c.grade ?? 0),
          Number(c.order_num ?? c.orderNum ?? 99),
          c.is_favorite ? 1 : 0,
        ]
      )
    }

    // 6. Upsert Course Categories (Units)
    for (const cc of courseCategories) {
      await conn.query(
        `INSERT INTO course_categories (id, course_id, name, order_num)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           course_id = VALUES(course_id),
           name = VALUES(name),
           order_num = VALUES(order_num);`,
        [cc.id, cc.course_id || cc.courseId, cc.name, Number(cc.order_num ?? cc.orderNum ?? 1)]
      )
    }

    // 7. Upsert Lessons (preserve completed_count and is_recent if already practiced locally)
    for (const l of lessons) {
      await conn.query(
        `INSERT INTO lessons (id, course_id, category_id, lesson_number, title_en, title_cn, practice_time_seconds, completed_count, is_recent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           course_id = VALUES(course_id),
           category_id = VALUES(category_id),
           lesson_number = VALUES(lesson_number),
           title_en = VALUES(title_en),
           title_cn = VALUES(title_cn);`,
        [
          l.id,
          l.course_id || l.courseId,
          l.category_id || l.categoryId || null,
          Number(l.lesson_number ?? l.lessonNumber ?? 1),
          l.title_en || l.titleEn || '',
          l.title_cn || l.titleCn || '',
          Number(l.practice_time_seconds ?? l.practiceTimeSeconds ?? 60),
          Number(l.completed_count ?? 0),
          l.is_recent ? 1 : 0,
        ]
      )
    }

    // 8. Upsert Sentences & Words for imported lessons
    const importedSentenceIds = sentences.map(s => s.id).filter(Boolean)
    if (importedSentenceIds.length > 0) {
      await conn.query('DELETE FROM words WHERE sentence_id IN (?);', [importedSentenceIds])
    }

    for (const s of sentences) {
      await conn.query(
        `INSERT INTO sentences (id, lesson_id, sentence_index, sentence_en, sentence_cn, image_url)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           lesson_id = VALUES(lesson_id),
           sentence_index = VALUES(sentence_index),
           sentence_en = VALUES(sentence_en),
           sentence_cn = VALUES(sentence_cn),
           image_url = VALUES(image_url);`,
        [
          s.id,
          s.lesson_id || s.lessonId,
          Number(s.sentence_index ?? s.index ?? 1),
          s.sentence_en || s.sentenceEn || '',
          s.sentence_cn || s.sentenceCn || '',
          s.image_url || s.imageUrl || null,
        ]
      )
    }

    for (const w of words) {
      await conn.query(
        `INSERT INTO words (id, sentence_id, word_index, word, meaning, phonetic, pos_tag)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           sentence_id = VALUES(sentence_id),
           word_index = VALUES(word_index),
           word = VALUES(word),
           meaning = VALUES(meaning),
           phonetic = VALUES(phonetic),
           pos_tag = VALUES(pos_tag);`,
        [
          w.id,
          w.sentence_id || w.sentenceId,
          Number(w.word_index ?? w.index ?? 1),
          w.word || '',
          w.meaning || '',
          w.phonetic || '',
          w.pos_tag || w.posTag || null,
        ]
      )
    }

    // 9. Sync course lesson_count with actual lessons count
    await conn.query('UPDATE courses SET lesson_count = (SELECT COUNT(*) FROM lessons WHERE lessons.course_id = courses.id);')

    // 10. Update content_version & last_sync_at
    const newVersion = bundle.contentVersion || new Date().toISOString().slice(0, 16).replace(/[-T:]/g, '.')
    await conn.query(
      `INSERT INTO system_meta (meta_key, meta_value, updated_at) VALUES (?, ?, NOW())
       ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value), updated_at = NOW();`,
      ['content_version', newVersion]
    )
    await conn.query(
      `INSERT INTO system_meta (meta_key, meta_value, updated_at) VALUES (?, ?, NOW())
       ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value), updated_at = NOW();`,
      ['last_sync_at', new Date().toISOString()]
    )

    await conn.commit()

    // Optionally save updated snapshot to server/builtin-snapshot.json
    if (options?.updateBuiltinSnapshot) {
      try {
        const freshBundle = await exportCourseBundle()
        fs.writeFileSync(SNAPSHOT_FILE_PATH, JSON.stringify(freshBundle, null, 2), 'utf-8')
      } catch (e) {
        console.warn('Could not write builtin-snapshot.json:', e)
      }
    }

    return {
      success: true,
      contentVersion: newVersion,
      imported: {
        courses: courses.length,
        lessons: lessons.length,
        sentences: sentences.length,
        words: words.length,
        ttsDictionary: ttsDictionary.length,
      },
    }
  } catch (err) {
    try {
      await conn.rollback()
    } catch {}
    throw err
  } finally {
    conn.release()
  }
}

export async function initDatabase() {
  const conn = await pool.getConnection()
  try {
    console.log(
      DB_MODE === 'mysql'
        ? `Initializing MySQL database at: ${MYSQL_CONFIG.host}:${MYSQL_CONFIG.port}/${MYSQL_CONFIG.database}`
        : `Initializing embedded SQLite database at: ${DB_FILE_PATH}`
    )

    // 0. System metadata table for content version & cloud sync config
    await execDdl(`
      CREATE TABLE IF NOT EXISTS system_meta (
        meta_key TEXT PRIMARY KEY,
        meta_value TEXT,
        updated_at TEXT DEFAULT (datetime('now', 'localtime'))
      );
    `)

    // 1. User profile table
    await execDdl(`
      CREATE TABLE IF NOT EXISTS user_profile (
        id TEXT PRIMARY KEY,
        nickname TEXT NOT NULL,
        avatar TEXT,
        role TEXT DEFAULT '普通用户',
        phone TEXT,
        email TEXT,
        password_hash TEXT,
        must_change_password INTEGER DEFAULT 0,
        reset_token TEXT,
        reset_token_expires TEXT,
        status TEXT DEFAULT 'active',
        total_study_seconds INTEGER DEFAULT 0,
        today_study_seconds INTEGER DEFAULT 0,
        month_study_seconds INTEGER DEFAULT 0,
        total_sentence_count INTEGER DEFAULT 0,
        today_sentence_count INTEGER DEFAULT 0,
        continuous_days INTEGER DEFAULT 1,
        last_checkin_date TEXT DEFAULT NULL,
        exp INTEGER DEFAULT 0,
        level INTEGER DEFAULT 1,
        today_exp INTEGER DEFAULT 0,
        last_exp_date TEXT DEFAULT NULL,
        vip_type TEXT DEFAULT 'free',
        vip_expire_at TEXT DEFAULT NULL,
        has_ever_vip INTEGER DEFAULT 0,
        last_vip_type TEXT DEFAULT NULL,
        today_used_seconds INTEGER DEFAULT 0,
        last_quota_date TEXT DEFAULT NULL,
        settings_json TEXT,
        menu_config_json TEXT,
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT DEFAULT (datetime('now', 'localtime'))
      );
    `)

    // Safe schema migration for existing user_profile tables (works in both SQLite & MySQL)
    const missingUserCols: Array<[string, string]> = [
      ['password_hash', 'TEXT'],
      ['must_change_password', 'INTEGER DEFAULT 0'],
      ['reset_token', 'TEXT'],
      ['reset_token_expires', 'TEXT'],
      ['exp', 'INTEGER DEFAULT 0'],
      ['level', 'INTEGER DEFAULT 1'],
      ['today_exp', 'INTEGER DEFAULT 0'],
      ['last_exp_date', 'TEXT DEFAULT NULL'],
      ['vip_type', "VARCHAR(64) DEFAULT 'free'"],
      ['vip_expire_at', 'TEXT DEFAULT NULL'],
      ['has_ever_vip', 'INTEGER DEFAULT 0'],
      ['last_vip_type', 'TEXT DEFAULT NULL'],
      ['today_used_seconds', 'INTEGER DEFAULT 0'],
      ['last_quota_date', 'TEXT DEFAULT NULL'],
    ]
    for (const [colName, colDef] of missingUserCols) {
      const [colRows] = await conn.query<any[]>(`SHOW COLUMNS FROM user_profile LIKE '${colName}';`)
      if (!colRows || colRows.length === 0) {
        const mysqlSafeDef = DB_MODE === 'mysql' ? colDef.replace(/\bINTEGER\b/gi, 'INT') : colDef
        await conn.query(`ALTER TABLE user_profile ADD COLUMN ${colName} ${mysqlSafeDef};`)
      }
    }

    // 1.1 Independent Admin Users table
    await execDdl(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'super_admin',
        is_immutable INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT DEFAULT (datetime('now', 'localtime'))
      );
    `)

    // 1.2 Email Logs table
    await execDdl(`
      CREATE TABLE IF NOT EXISTS email_logs (
        id TEXT PRIMARY KEY,
        recipient TEXT NOT NULL,
        subject TEXT NOT NULL,
        content_preview TEXT,
        temp_password TEXT,
        reset_link TEXT,
        status TEXT DEFAULT 'sent',
        error_msg TEXT,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
      );
    `)

    // 1.3 Admin Audit Logs table
    await execDdl(`
      CREATE TABLE IF NOT EXISTS admin_audit_logs (
        id TEXT PRIMARY KEY,
        admin_username TEXT NOT NULL,
        action TEXT NOT NULL,
        target_user_id TEXT,
        target_email TEXT,
        details TEXT,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
      );
    `)

    // 1.4 VIP Upgrade Requests & Two-Way Messages tables
    await execDdl(`
      CREATE TABLE IF NOT EXISTS vip_upgrade_requests (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        user_email TEXT,
        user_nickname TEXT,
        current_vip_type TEXT NOT NULL,
        target_vip_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT DEFAULT (datetime('now', 'localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_vip_req_user ON vip_upgrade_requests (user_id);
    `)

    await execDdl(`
      CREATE TABLE IF NOT EXISTS vip_upgrade_messages (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        sender_role TEXT NOT NULL,
        sender_name TEXT,
        content TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_vip_msg_req ON vip_upgrade_messages (request_id);
    `)

    // 1c. Per-client-type single-slot active sessions (1 web + 1 desktop allowed concurrently)
    await execDdl(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        client_type TEXT NOT NULL,
        session_id TEXT NOT NULL,
        device_info TEXT DEFAULT '',
        updated_at TEXT DEFAULT (datetime('now', 'localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_user_sessions_uid ON user_sessions (user_id);
    `)

    // 1d. Idempotent sync events table (prevents duplicate EXP/duration counting on retries or outbox replay)
    await execDdl(`
      CREATE TABLE IF NOT EXISTS sync_events (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        client_type TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_sync_events_uid ON sync_events (user_id);
    `)

    // 2. Purchase records
    await execDdl(`
      CREATE TABLE IF NOT EXISTS purchase_records (
        id TEXT PRIMARY KEY,
        order_no TEXT NOT NULL,
        course_name TEXT NOT NULL,
        purchase_time TEXT NOT NULL,
        amount REAL DEFAULT 0.00,
        status TEXT DEFAULT 'completed'
      );
    `)

    // 3. Courses and Teaching Materials table
    await execDdl(`
      CREATE TABLE IF NOT EXISTS courses (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        instructor_name TEXT NOT NULL,
        instructor_avatar TEXT,
        lesson_count INTEGER DEFAULT 0,
        completed_lessons INTEGER DEFAULT 0,
        cover TEXT,
        category TEXT DEFAULT 'all',
        school_level TEXT DEFAULT 'all',
        grade INTEGER DEFAULT 0,
        order_num INTEGER DEFAULT 99,
        is_favorite INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
      );
    `)

    // 4. Course Categories (Units / Subcategories under courses or teaching materials)
    await execDdl(`
      CREATE TABLE IF NOT EXISTS course_categories (
        id TEXT PRIMARY KEY,
        course_id TEXT NOT NULL,
        name TEXT NOT NULL,
        order_num INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_course_cat ON course_categories (course_id);
    `)

    // 5. Lessons table
    await execDdl(`
      CREATE TABLE IF NOT EXISTS lessons (
        id TEXT PRIMARY KEY,
        course_id TEXT NOT NULL,
        category_id TEXT,
        lesson_number INTEGER NOT NULL,
        title_en TEXT NOT NULL,
        title_cn TEXT NOT NULL,
        practice_time_seconds INTEGER DEFAULT 0,
        completed_count INTEGER DEFAULT 0,
        is_recent INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_course_lesson ON lessons (course_id);
    `)

    // 6. Sentences table
    await execDdl(`
      CREATE TABLE IF NOT EXISTS sentences (
        id TEXT PRIMARY KEY,
        lesson_id TEXT NOT NULL,
        sentence_index INTEGER NOT NULL,
        sentence_en TEXT NOT NULL,
        sentence_cn TEXT NOT NULL,
        image_url TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_lesson_sentence ON sentences (lesson_id);
    `)

    // 7. Words table
    await execDdl(`
      CREATE TABLE IF NOT EXISTS words (
        id TEXT PRIMARY KEY,
        sentence_id TEXT NOT NULL,
        word_index INTEGER NOT NULL,
        word TEXT NOT NULL,
        meaning TEXT NOT NULL,
        phonetic TEXT NOT NULL,
        pos_tag TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sentence_word ON words (sentence_id);
    `)

    // 8. Reviews table (Error notebook & unfamiliar list)
    await execDdl(`
      CREATE TABLE IF NOT EXISTS reviews (
        id TEXT PRIMARY KEY,
        user_id TEXT DEFAULT '8723192',
        sentence_en TEXT NOT NULL,
        sentence_cn TEXT NOT NULL,
        phonetic TEXT,
        words_json TEXT,
        course_title TEXT,
        source TEXT NOT NULL,
        error_count INTEGER DEFAULT 1,
        is_learned INTEGER DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_reviews_user ON reviews (user_id);
    `)

    // 9. User Favorites table
    await execDdl(`
      CREATE TABLE IF NOT EXISTS user_favorites (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT '8723192',
        course_id TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        UNIQUE (user_id, course_id)
      );
      CREATE INDEX IF NOT EXISTS idx_fav_user ON user_favorites (user_id);
    `)

    // 10. User Favorite Sentences table
    await execDdl(`
      CREATE TABLE IF NOT EXISTS user_favorite_sentences (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT '8723192',
        sentence_id TEXT,
        sentence_en TEXT NOT NULL,
        sentence_cn TEXT NOT NULL,
        phonetic TEXT,
        course_title TEXT,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_fav_sen_user ON user_favorite_sentences (user_id);
    `)

    // 11. Feedback reports table
    await execDdl(`
      CREATE TABLE IF NOT EXISTS feedback_reports (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT '8723192',
        report_type TEXT NOT NULL,
        description TEXT,
        sentence_en TEXT,
        course_title TEXT,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
      );
    `)

    // 12. TTS Dictionary corrections table
    await execDdl(`
      CREATE TABLE IF NOT EXISTS tts_dictionary (
        id TEXT PRIMARY KEY,
        word TEXT NOT NULL UNIQUE,
        spoken_alias TEXT,
        ipa TEXT,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
      );
    `)

    // 13. User Course Progress table
    await execDdl(`
      CREATE TABLE IF NOT EXISTS user_course_progress (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT '8723192',
        course_id TEXT NOT NULL,
        lesson_id TEXT NOT NULL,
        sentence_index INTEGER NOT NULL DEFAULT 0,
        total_sentences INTEGER NOT NULL DEFAULT 0,
        progress_percent INTEGER NOT NULL DEFAULT 0,
        course_title TEXT,
        lesson_title TEXT,
        lesson_number INTEGER DEFAULT 1,
        study_seconds INTEGER DEFAULT 0,
        last_practiced_at TEXT DEFAULT (datetime('now', 'localtime')),
        UNIQUE (user_id, course_id)
      );
      CREATE INDEX IF NOT EXISTS idx_user_progress ON user_course_progress (user_id);
    `)

    // 14. Course Categories Table
    await execDdl(`
      CREATE TABLE IF NOT EXISTS category_courses (
        id TEXT PRIMARY KEY,
        cat_key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        order_num INTEGER DEFAULT 99,
        is_enabled INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT DEFAULT (datetime('now', 'localtime'))
      );
    `)

    // 15. Teaching School Levels Table
    await execDdl(`
      CREATE TABLE IF NOT EXISTS category_school_levels (
        id TEXT PRIMARY KEY,
        level_key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        order_num INTEGER DEFAULT 99,
        is_enabled INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT DEFAULT (datetime('now', 'localtime'))
      );
    `)

    // 16. Teaching Grades Table
    await execDdl(`
      CREATE TABLE IF NOT EXISTS category_grades (
        id TEXT PRIMARY KEY,
        level_key TEXT NOT NULL,
        grade_value INTEGER NOT NULL,
        name TEXT NOT NULL,
        order_num INTEGER DEFAULT 99,
        is_enabled INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT DEFAULT (datetime('now', 'localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_lvl_key ON category_grades (level_key);
    `)

    // Seed default categories if empty
    const [cCatRows] = await conn.query<any[]>('SELECT COUNT(*) as cnt FROM category_courses;')
    if (cCatRows[0].cnt === 0) {
      await conn.query(`
        INSERT INTO category_courses (id, cat_key, name, order_num, is_enabled) VALUES
        ('cat_zero', 'zero', '零基础', 1, 1),
        ('cat_intro', 'intro', '入门', 2, 1),
        ('cat_elementary', 'elementary', '初级', 3, 1),
        ('cat_intermediate', 'intermediate', '中级', 4, 1),
        ('cat_advanced', 'advanced', '进阶', 5, 1),
        ('cat_master', 'master', '高级', 6, 1);
      `)
    }

    const [lvlRows] = await conn.query<any[]>('SELECT COUNT(*) as cnt FROM category_school_levels;')
    if (lvlRows[0].cnt === 0) {
      await conn.query(`
        INSERT INTO category_school_levels (id, level_key, name, order_num, is_enabled) VALUES
        ('lvl_primary', 'primary', '小学', 1, 1),
        ('lvl_junior', 'junior', '初中', 2, 1),
        ('lvl_senior', 'senior', '高中', 3, 1),
        ('lvl_college', 'college', '大学', 4, 1);
      `)
    }

    const [grdRows] = await conn.query<any[]>('SELECT COUNT(*) as cnt FROM category_grades;')
    if (grdRows[0].cnt === 0) {
      await conn.query(`
        INSERT INTO category_grades (id, level_key, grade_value, name, order_num, is_enabled) VALUES
        ('grd_p1', 'primary', 1, '一年级', 1, 1),
        ('grd_p2', 'primary', 2, '二年级', 2, 1),
        ('grd_p3', 'primary', 3, '三年级', 3, 1),
        ('grd_p4', 'primary', 4, '四年级', 4, 1),
        ('grd_p5', 'primary', 5, '五年级', 5, 1),
        ('grd_p6', 'primary', 6, '六年级', 6, 1),
        ('grd_j1', 'junior', 7, '七年级(初一)', 1, 1),
        ('grd_j2', 'junior', 8, '八年级(初二)', 2, 1),
        ('grd_j3', 'junior', 9, '九年级(初三)', 3, 1),
        ('grd_s1', 'senior', 10, '高一', 1, 1),
        ('grd_s2', 'senior', 11, '高二', 2, 1),
        ('grd_s3', 'senior', 12, '高三', 3, 1),
        ('grd_c1', 'college', 13, '大一', 1, 1),
        ('grd_c2', 'college', 14, '大二', 2, 1),
        ('grd_c3', 'college', 15, '大三', 3, 1),
        ('grd_c4', 'college', 16, '大四', 4, 1);
      `)
    }

    // Check if initial seeding is needed
    const [courseRows] = await conn.query<any[]>('SELECT COUNT(*) as cnt FROM courses;')
    if (courseRows[0].cnt === 0) {
      console.log('Seeding initial courses, lessons, and sentences into embedded SQLite...')
      await seedInitialData(conn)
    }

    // Ensure mock users, learning progress, favorites and reviews
    await ensureMockUsersAndProgress(conn)

    // Seed default immutable super admin
    const [adminRows] = await conn.query<any[]>("SELECT id FROM admin_users WHERE username = 'admin';")
    if (adminRows.length === 0) {
      const initAdminPwd = process.env.YANXIDAO_INIT_ADMIN_PASSWORD?.trim() || 'AsAhouse34231724'
      await conn.query(
        `INSERT INTO admin_users (id, username, password_hash, role, is_immutable) VALUES (?, 'admin', ?, 'super_admin', 1);`,
        ['admin_super_001', hashPassword(initAdminPwd)]
      )
      console.log('✅ Default immutable super admin initialized (username: admin)')
    }

    // Backfill default account email & password for inherited user 8723192 if needed
    const [u872] = await conn.query<any[]>("SELECT id, email, password_hash, exp, total_study_seconds, total_sentence_count FROM user_profile WHERE id = '8723192';")
    if (u872.length > 0) {
      const u = u872[0]
      if (!u.password_hash) {
        const defaultEmail = u.email || 'benjamin@yanxidao.com'
        await conn.query(
          `UPDATE user_profile SET email = ?, password_hash = ? WHERE id = '8723192';`,
          [defaultEmail, hashPassword('123456')]
        )
      }
    }

    // Auto-check built-in snapshot file (if newer contentVersion is bundled with installer)
    if (fs.existsSync(SNAPSHOT_FILE_PATH)) {
      try {
        const snapshotRaw = fs.readFileSync(SNAPSHOT_FILE_PATH, 'utf-8')
        const snapshot = JSON.parse(snapshotRaw)
        const localVer = await getSystemMeta('content_version', '')
        if (snapshot.contentVersion && snapshot.contentVersion > localVer) {
          console.log(`Merging newer built-in course snapshot (${snapshot.contentVersion} > ${localVer || 'none'})...`)
          await importCourseBundle(snapshot, { updateBuiltinSnapshot: false })
        }
      } catch (e) {
        console.warn('Skipped built-in snapshot merge:', e)
      }
    } else {
      // Generate initial builtin-snapshot.json if not present
      try {
        const initialBundle = await exportCourseBundle()
        await setSystemMeta('content_version', initialBundle.contentVersion)
        await setSystemMeta('last_sync_at', initialBundle.exportedAt)
        fs.writeFileSync(SNAPSHOT_FILE_PATH, JSON.stringify(initialBundle, null, 2), 'utf-8')
        console.log('Generated initial builtin-snapshot.json')
      } catch (e) {
        console.warn('Could not generate initial builtin-snapshot.json:', e)
      }
    }

    // Keep course.lesson_count strictly in sync with lessons table
    await conn.query('UPDATE courses SET lesson_count = (SELECT COUNT(*) FROM lessons WHERE lessons.course_id = courses.id);')

    console.log('✅ Embedded SQLite database initialized successfully!')
  } finally {
    conn.release()
  }
}

async function seedInitialData(conn: any) {
  // 1. Seed user profile
  await conn.query(`
    INSERT INTO user_profile (id, nickname, avatar, role, total_study_seconds, today_study_seconds, month_study_seconds, total_sentence_count, today_sentence_count, continuous_days)
    VALUES ('8723192', '本傑明 🤠', 'https://api.dicebear.com/7.x/bottts/svg?seed=yanxidao_benjamin', '普通用户', 780, 118, 118, 6, 6, 1)
    ON DUPLICATE KEY UPDATE id=id;
  `)

  // 2. Seed purchase records
  await conn.query(`
    INSERT INTO purchase_records (id, order_no, course_name, purchase_time, amount, status)
    VALUES ('ord_001', 'YXD20260922001', '高频英语700句全场景通关', '2026-09-22 10:15:00', 0.00, 'completed')
    ON DUPLICATE KEY UPDATE id=id;
  `)

  // 3. Seed Courses
  const courses = [
    { id: 'c_700', type: 'course', title: '高频英语700句全场景通关', instructor: 'Lucas', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Lucas', lessons: 6, cover: 'https://images.unsplash.com/photo-1544717305-2782549b5136?w=400&q=80', cat: 'intro', fav: 1, orderNum: 1 },
    { id: 'c_daily', type: 'course', title: '零基础日常生活表达', instructor: 'Stella', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Stella', lessons: 0, cover: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=400&q=80', cat: 'zero', fav: 0, orderNum: 2 },
    { id: 'c_travel', type: 'course', title: '出国旅行常用英语', instructor: 'Tristan', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Tristan', lessons: 0, cover: 'https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=400&q=80', cat: 'elementary', fav: 0, orderNum: 3 },
    { id: 'c_trade', type: 'course', title: '做外贸必备英语口语课', instructor: 'Lucas', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Lucas', lessons: 0, cover: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=400&q=80', cat: 'intermediate', fav: 0, orderNum: 4 },
    { id: 'c_ielts', type: 'course', title: '雅思口语地道表达1350句', instructor: 'Stella', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Stella', lessons: 0, cover: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=400&q=80', cat: 'advanced', fav: 0, orderNum: 5 },
    { id: 'c_parenting', type: 'course', title: '万用亲子英语8000句', instructor: 'Luna', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Luna', lessons: 0, cover: 'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=400&q=80', cat: 'intro', fav: 0, orderNum: 6 },
  ]

  for (const c of courses) {
    await conn.query(`
      INSERT INTO courses (id, type, title, instructor_name, instructor_avatar, lesson_count, cover, category, is_favorite, order_num)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE title=VALUES(title);
    `, [c.id, c.type, c.title, c.instructor, c.avatar, c.lessons, c.cover, c.cat, c.fav, c.orderNum])
  }

  // 4. Seed Teaching Materials
  const teaching = [
    { id: 'tm_pep_4_up', type: 'teaching', title: '四年级上册人教版PEP', instructor: 'Lucas', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Lucas', lessons: 0, cover: 'https://images.unsplash.com/photo-1497633762265-9d179a990aa6?w=400&q=80', lvl: 'primary', grade: 4, orderNum: 1 },
    { id: 'tm_grade_3_a', type: 'teaching', title: '三年级通用课程A版', instructor: 'Luna', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Luna', lessons: 0, cover: 'https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=400&q=80', lvl: 'primary', grade: 3, orderNum: 2 },
    { id: 'tm_grade_1_a', type: 'teaching', title: '一年级通用课程A版', instructor: 'Luna', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Luna', lessons: 0, cover: 'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=400&q=80', lvl: 'primary', grade: 1, orderNum: 3 },
    { id: 'tm_grade_3_300', type: 'teaching', title: '精选300组核心英文句型', instructor: 'Maeve', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Maeve', lessons: 0, cover: 'https://images.unsplash.com/photo-1544717305-2782549b5136?w=400&q=80', lvl: 'primary', grade: 3, orderNum: 4 },
  ]

  for (const t of teaching) {
    await conn.query(`
      INSERT INTO courses (id, type, title, instructor_name, instructor_avatar, lesson_count, cover, school_level, grade, order_num)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE title=VALUES(title);
    `, [t.id, t.type, t.title, t.instructor, t.avatar, t.lessons, t.cover, t.lvl, t.grade, t.orderNum])
  }

  // 5. Seed Category for c_700
  const catId = 'cat_700_1'
  await conn.query(`
    INSERT INTO course_categories (id, course_id, name, order_num)
    VALUES (?, 'c_700', '日常社交问候单元', 1)
    ON DUPLICATE KEY UPDATE name=VALUES(name);
  `, [catId])

  // 6. Seed Lessons for c_700
  const lessons = [
    { id: 'lesson_700_1', num: 1, en: 'Lesson 1: Hello and How Are You', cn: '第一课：打招呼与日常问候', secs: 118, recent: 1 },
    { id: 'lesson_700_2', num: 2, en: 'Lesson 2: Yes, No and In Between', cn: '第二课：同意、拒绝与模糊回应', secs: 90, recent: 0 },
    { id: 'lesson_700_3', num: 3, en: 'Lesson 3: Reacting in the Moment', cn: '第三课：即时反应与口语回应', secs: 90, recent: 0 },
    { id: 'lesson_700_4', num: 4, en: 'Lesson 4: Giving Orders and Instructions', cn: '第四课：指令与祈使句', secs: 90, recent: 0 },
    { id: 'lesson_700_5', num: 5, en: 'Lesson 5: Asking for Help and Directions', cn: '第五课：求助与问路', secs: 90, recent: 0 },
    { id: 'lesson_700_6', num: 6, en: 'Lesson 6: Talking About Feelings', cn: '第六课：表达情绪与内心状态', secs: 90, recent: 0 },
  ]

  for (const l of lessons) {
    await conn.query(`
      INSERT INTO lessons (id, course_id, category_id, lesson_number, title_en, title_cn, practice_time_seconds, is_recent)
      VALUES (?, 'c_700', ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE title_en=VALUES(title_en);
    `, [l.id, catId, l.num, l.en, l.cn, l.secs, l.recent])
  }

  // 7. Seed Sentences & Words for lesson_700_1
  const sentencesData = [
    {
      id: 's_1',
      index: 1,
      en: "What's up?",
      cn: '怎么了？最近咋样？',
      img: 'https://images.unsplash.com/photo-1577495508048-b635879837f1?w=500&q=80',
      words: [
        { index: 1, word: "What's", meaning: '什么', phonetic: 'wʌts', tag: '话语标记' },
        { index: 2, word: 'up', meaning: '最近咋样', phonetic: 'ʌp', tag: '表语' },
      ],
    },
    {
      id: 's_2',
      index: 2,
      en: 'How are you doing?',
      cn: '你最近怎么样？',
      img: 'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=500&q=80',
      words: [
        { index: 1, word: 'How', meaning: '如何', phonetic: 'haʊ', tag: '疑问副词' },
        { index: 2, word: 'are', meaning: '是', phonetic: 'ɑːr', tag: '系动词' },
        { index: 3, word: 'you', meaning: '你', phonetic: 'juː', tag: '主语' },
        { index: 4, word: 'doing', meaning: '过得', phonetic: 'ˈduːɪŋ', tag: '现在分词' },
      ],
    },
    {
      id: 's_3',
      index: 3,
      en: 'Long time no see!',
      cn: '好久不见！',
      words: [
        { index: 1, word: 'Long', meaning: '长的', phonetic: 'lɒŋ', tag: '定语' },
        { index: 2, word: 'time', meaning: '时间', phonetic: 'taɪm', tag: '名词' },
        { index: 3, word: 'no', meaning: '没有', phonetic: 'nəʊ', tag: '否定词' },
        { index: 4, word: 'see', meaning: '见到', phonetic: 'siː', tag: '动词' },
      ],
    },
    {
      id: 's_4',
      index: 4,
      en: 'Good morning!',
      cn: '早上好！',
      words: [
        { index: 1, word: 'Good', meaning: '好的', phonetic: 'ɡʊd', tag: '定语' },
        { index: 2, word: 'morning', meaning: '早晨', phonetic: 'ˈmɔːnɪŋ', tag: '呼语' },
      ],
    },
    {
      id: 's_5',
      index: 5,
      en: 'Good night.',
      cn: '晚安。',
      words: [
        { index: 1, word: 'Good', meaning: '好的', phonetic: 'ɡʊd', tag: '定语' },
        { index: 2, word: 'night', meaning: '夜晚', phonetic: 'naɪt', tag: '呼语' },
      ],
    },
    {
      id: 's_6',
      index: 6,
      en: 'Have a nice day!',
      cn: '祝你今天愉快！',
      words: [
        { index: 1, word: 'Have', meaning: '拥有', phonetic: 'hæv', tag: '动词' },
        { index: 2, word: 'a', meaning: '一个', phonetic: 'ə', tag: '冠词' },
        { index: 3, word: 'nice', meaning: '美好的', phonetic: 'naɪs', tag: '形容词' },
        { index: 4, word: 'day', meaning: '日子', phonetic: 'deɪ', tag: '名词' },
      ],
    },
  ]

  for (const s of sentencesData) {
    await conn.query(`
      INSERT INTO sentences (id, lesson_id, sentence_index, sentence_en, sentence_cn, image_url)
      VALUES (?, 'lesson_700_1', ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE sentence_en=VALUES(sentence_en);
    `, [s.id, s.index, s.en, s.cn, s.img || null])

    for (const w of s.words) {
      await conn.query(`
        INSERT INTO words (id, sentence_id, word_index, word, meaning, phonetic, pos_tag)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE word=VALUES(word);
      `, [`${s.id}_w_${w.index}`, s.id, w.index, w.word, w.meaning, w.phonetic, w.tag])
    }
  }

  // 8. Seed Reviews
  const reviewsSeed = [
    {
      id: 'rev_1',
      sentence_en: "What's up?",
      sentence_cn: '怎么了？最近咋样？',
      phonetic: 'wʌts ʌp',
      words_json: JSON.stringify([{ word: "What's", phonetic: 'wʌts' }, { word: 'up', phonetic: 'ʌp' }]),
      course_title: '高频英语700句全场景通关',
      source: 'error',
      error_count: 3,
      created_at: '2026-09-22 10:33:25',
    },
    {
      id: 'rev_2',
      sentence_en: 'See you later.',
      sentence_cn: '回头见。',
      phonetic: 'siː juː ˈleɪtər',
      words_json: JSON.stringify([{ word: 'See', phonetic: 'siː' }, { word: 'you', phonetic: 'juː' }, { word: 'later', phonetic: 'ˈleɪtər' }]),
      course_title: '高频英语700句全场景通关',
      source: 'error',
      error_count: 2,
      created_at: '2026-09-22 10:23:50',
    },
  ]
  for (const r of reviewsSeed) {
    await conn.query(`
      INSERT INTO reviews (id, sentence_en, sentence_cn, phonetic, words_json, course_title, source, error_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE error_count=VALUES(error_count);
    `, [r.id, r.sentence_en, r.sentence_cn, r.phonetic, r.words_json, r.course_title, r.source, r.error_count, r.created_at])
  }

  // 9. Seed TTS Dictionary
  await conn.query(`
    INSERT INTO tts_dictionary (id, word, spoken_alias, ipa)
    VALUES 
    ('dict_1', 'iPhone', 'I phone', ''),
    ('dict_2', 'UNESCO', '', 'juːˈnɛskoʊ'),
    ('dict_3', 'YanXiDao', 'yan xi island', '')
    ON DUPLICATE KEY UPDATE word=word;
  `)
}

async function ensureMockUsersAndProgress(conn: any) {
  try {
    await conn.query(`
      UPDATE user_profile 
      SET phone = COALESCE(phone, '13800138001'), 
          email = COALESCE(email, 'benjamin@yanxidao.com'),
          status = COALESCE(status, 'active')
      WHERE id = '8723192';
    `)

    const [existing] = await conn.query<any[]>("SELECT id FROM user_profile WHERE id IN ('8723193', '8723194', '8723195', '8723196');")
    if (existing.length < 4) {
      const mockUsers = [
        {
          id: '8723193',
          nickname: '艾米丽 (Emily) 🌸',
          avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Emily',
          role: 'VIP学员',
          phone: '13912345678',
          email: 'emily@example.com',
          status: 'active',
          total_study_seconds: 11300,
          today_study_seconds: 1200,
          month_study_seconds: 11300,
          total_sentence_count: 20,
          today_sentence_count: 12,
          continuous_days: 28,
        },
        {
          id: '8723194',
          nickname: '王小明 (Leo) 🚀',
          avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Leo',
          role: '普通用户',
          phone: '13787654321',
          email: 'leo.wang@example.com',
          status: 'active',
          total_study_seconds: 1950,
          today_study_seconds: 300,
          month_study_seconds: 1950,
          total_sentence_count: 4,
          today_sentence_count: 4,
          continuous_days: 5,
        },
        {
          id: '8723195',
          nickname: '陈子涵 (Sarah) 📚',
          avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Sarah',
          role: 'VIP学员',
          phone: '13566778899',
          email: 'sarah.chen@example.com',
          status: 'active',
          total_study_seconds: 0,
          today_study_seconds: 0,
          month_study_seconds: 0,
          total_sentence_count: 0,
          today_sentence_count: 0,
          continuous_days: 0,
        },
        {
          id: '8723196',
          nickname: '张浩然 (David) ⚡',
          avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=David',
          role: '体验学员',
          phone: '15911223344',
          email: 'david.zhang@example.com',
          status: 'banned',
          total_study_seconds: 0,
          today_study_seconds: 0,
          month_study_seconds: 0,
          total_sentence_count: 0,
          today_sentence_count: 0,
          continuous_days: 0,
        },
      ]

      for (const u of mockUsers) {
        await conn.query(`
          INSERT INTO user_profile 
          (id, nickname, avatar, role, phone, email, status, total_study_seconds, today_study_seconds, month_study_seconds, total_sentence_count, today_sentence_count, continuous_days)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE nickname=VALUES(nickname), role=VALUES(role), phone=VALUES(phone), email=VALUES(email), status=VALUES(status);
        `, [u.id, u.nickname, u.avatar, u.role, u.phone, u.email, u.status, u.total_study_seconds, u.today_study_seconds, u.month_study_seconds, u.total_sentence_count, u.today_sentence_count, u.continuous_days])
      }

      // Seed progress for Benjamin & Emily & Leo
      await conn.query(`
        INSERT INTO user_course_progress 
        (id, user_id, course_id, lesson_id, sentence_index, total_sentences, progress_percent, course_title, lesson_title, lesson_number, study_seconds)
        VALUES 
        ('prog_8723192_c_700', '8723192', 'c_700', 'lesson_700_1', 6, 6, 100, '高频英语700句全场景通关', '第一课：打招呼与日常问候', 1, 780),
        ('prog_8723193_c_700', '8723193', 'c_700', 'lesson_700_1', 12, 15, 80, '高频英语700句全场景通关', '第一课：打招呼与日常问候', 1, 7200),
        ('prog_8723193_tm_pep_4_up', '8723193', 'tm_pep_4_up', 'lesson_pep_1', 8, 20, 40, '四年级上册人教版PEP', 'Unit 1 My Classroom', 1, 4100),
        ('prog_8723194_c_700', '8723194', 'c_700', 'lesson_700_1', 4, 15, 27, '高频英语700句全场景通关', '第一课：打招呼与日常问候', 1, 1950)
        ON DUPLICATE KEY UPDATE progress_percent=VALUES(progress_percent);
      `)

      await conn.query(`
        INSERT INTO user_favorites (id, user_id, course_id)
        VALUES 
        ('fav_ben_1', '8723192', 'c_700'),
        ('fav_em_1', '8723193', 'c_700'),
        ('fav_em_2', '8723193', 'tm_pep_4_up')
        ON DUPLICATE KEY UPDATE course_id=VALUES(course_id);
      `)

      await conn.query(`
        INSERT INTO user_favorite_sentences (id, user_id, sentence_en, sentence_cn, phonetic, course_title)
        VALUES 
        ('fav_sen_em_1', '8723193', 'Practice makes perfect.', '熟能生巧。', 'ˈpræktɪs meɪks ˈpɜːrfɪkt', '高频英语700句全场景通关'),
        ('fav_sen_em_2', '8723193', 'Where there is a will, there is a way.', '有志者事竟成。', 'wer ðer ɪz ə wɪl, ðer ɪz ə weɪ', '四年级上册人教版PEP')
        ON DUPLICATE KEY UPDATE sentence_en=VALUES(sentence_en);
      `)

      await conn.query(`
        INSERT INTO reviews (id, user_id, sentence_en, sentence_cn, phonetic, words_json, course_title, source, error_count, is_learned, created_at)
        VALUES 
        ('rev_em_1', '8723193', 'Could you please repeat that?', '你能再说一遍吗？', 'kʊd juː pliːz rɪˈpiːt ðæt', '[]', '高频英语700句全场景通关', 'error', 2, 0, '2026-09-23 14:10:00'),
        ('rev_em_2', '8723193', 'I really appreciate your help.', '我真的很感激你的帮助。', 'aɪ ˈriːəli əˈpriːʃieɪt jɔːr help', '[]', '高频英语700句全场景通关', 'unfamiliar', 1, 1, '2026-09-23 15:20:00'),
        ('rev_leo_1', '8723194', 'How have you been doing?', '你最近过得如何？', 'haʊ hæv juː biːn ˈduːɪŋ', '[]', '高频英语700句全场景通关', 'error', 4, 0, '2026-09-23 16:45:00')
        ON DUPLICATE KEY UPDATE error_count=VALUES(error_count);
      `)
    }
  } catch (err) {
    console.error('ensureMockUsersAndProgress error:', err)
  }
}
