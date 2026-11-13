import type { SentenceItem, WordToken } from '../types'

export interface ParseResult {
  success: boolean
  sentences?: SentenceItem[]
  errorLine?: number
  errorMessage?: string
}

export class ImporterService {
  /**
   * Strictly validates and parses TXT file content according to SRS V3.0 Section 3.3.3
   * Template: 句子序号|英文句子|单词序号:单词:中文意思:音标;单词序号:单词:中文意思:音标;...
   */
  public parseTxtContent(content: string): ParseResult {
    if (!content || !content.trim()) {
      return {
        success: false,
        errorMessage: '导入文件内容为空',
      }
    }

    const lines = content.split(/\r?\n/)
    const parsedSentences: SentenceItem[] = []

    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1
      const line = lines[i].trim()
      if (!line) continue // Skip empty lines

      // 1. Check for at least 2 '|' delimiters
      const pipeParts = line.split('|')
      if (pipeParts.length < 3) {
        return {
          success: false,
          errorLine: lineNum,
          errorMessage: `第 ${lineNum} 行格式错误：缺少主分隔符 '|'，必须包含句子序号、英文句子与单词列表三个主要部分`,
        }
      }

      const sentenceIndexStr = pipeParts[0].trim()
      const sentenceIndex = parseInt(sentenceIndexStr, 10)
      if (isNaN(sentenceIndex)) {
        return {
          success: false,
          errorLine: lineNum,
          errorMessage: `第 ${lineNum} 行格式错误：句子序号 '${sentenceIndexStr}' 不是合法的整数`,
        }
      }

      const sentenceEn = pipeParts[1].trim()
      if (!sentenceEn) {
        return {
          success: false,
          errorLine: lineNum,
          errorMessage: `第 ${lineNum} 行格式错误：英文句子内容不能为空`,
        }
      }

      const rawWordsPart = pipeParts.slice(2).join('|').trim()
      if (!rawWordsPart) {
        return {
          success: false,
          errorLine: lineNum,
          errorMessage: `第 ${lineNum} 行格式错误：缺少单词拆解数据`,
        }
      }

      // 2. Parse words delimited by ';'
      const wordChunks = rawWordsPart.split(';').map(c => c.trim()).filter(Boolean)
      if (wordChunks.length === 0) {
        return {
          success: false,
          errorLine: lineNum,
          errorMessage: `第 ${lineNum} 行格式错误：未找到以 ';' 分隔的单词定义`,
        }
      }

      const words: WordToken[] = []
      for (let wIdx = 0; wIdx < wordChunks.length; wIdx++) {
        const chunk = wordChunks[wIdx]
        // Split by ':' -> 单词序号:单词:中文意思:音标
        const attrs = chunk.split(':').map(a => a.trim())
        if (attrs.length < 4) {
          return {
            success: false,
            errorLine: lineNum,
            errorMessage: `第 ${lineNum} 行单词格式错误：'${chunk}' 缺少属性。必须为 '序号:单词:中文意思:音标'`,
          }
        }

        const wordIndex = parseInt(attrs[0], 10)
        const word = attrs[1]
        const meaning = attrs[2]
        const phonetic = attrs[3]

        if (!word) {
          return {
            success: false,
            errorLine: lineNum,
            errorMessage: `第 ${lineNum} 行格式错误：第 ${wIdx + 1} 个单词的单词拼写为空`,
          }
        }
        if (!phonetic) {
          return {
            success: false,
            errorLine: lineNum,
            errorMessage: `第 ${lineNum} 行格式错误：'${word}' 缺少音标字段（TTS 发音必须依赖音标）`,
          }
        }

        // Infer part of speech tag for UI presentation
        let posTag = '表语'
        if (wIdx === 0 && (word.toLowerCase().includes('what') || word.toLowerCase().includes('good') || word.toLowerCase().includes('hello'))) {
          posTag = '话语标记'
        } else if (word.toLowerCase() === 'good' || word.toLowerCase() === 'nice') {
          posTag = '定语'
        } else if (word.toLowerCase() === 'morning' || word.toLowerCase() === 'night') {
          posTag = '呼语'
        }

        words.push({
          index: isNaN(wordIndex) ? wIdx + 1 : wordIndex,
          word,
          meaning,
          phonetic,
          posTag,
        })
      }

      // Chinese sentence is the combined meanings or default
      const sentenceCn = words.map(w => w.meaning).join(' ')

      parsedSentences.push({
        index: sentenceIndex,
        sentenceEn,
        sentenceCn,
        words,
      })
    }

    return {
      success: true,
      sentences: parsedSentences,
    }
  }
}

export const importerService = new ImporterService()
