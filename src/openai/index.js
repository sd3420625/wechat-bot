import { remark } from 'remark'
import stripMarkdown from 'strip-markdown'
import OpenAIApi from 'openai'
import dotenv from 'dotenv'
const env = dotenv.config().parsed // 环境参数
import fs from 'fs'
import path from 'path'

const __dirname = path.resolve()
// 判断是否有 .env 文件, 没有则报错
const envPath = path.join(__dirname, '.env')
if (!fs.existsSync(envPath)) {
  console.log('❌ 请先根据文档，创建并配置.env文件！')
  process.exit(1)
}

let config = {
  apiKey: env.OPENAI_API_KEY,
  organization: '',
}
if (env.OPENAI_PROXY_URL) {
  config.baseURL = env.OPENAI_PROXY_URL
}
const openai = new OpenAIApi(config)
const chosen_model = env.OPENAI_MODEL || 'gpt-4o'

// 定义一个 Map 来存储会话上下文，最大容量10，过期时间30分钟
const conversationMap = new Map()

// 定义一个函数，用于清理过期的会话
function cleanConversationMap() {
  const now = Date.now()
  for (const [key, value] of conversationMap.entries()) {
    if (now - value.timestamp > 30 * 60 * 1000) {
      conversationMap.delete(key)
    }
  }
  // 如果超过最大容量，删除最早的会话
  if (conversationMap.size > 10) {
    const oldestKey = [...conversationMap.entries()].reduce((a, b) => (a[1].timestamp < b[1].timestamp ? a : b))[0]
    conversationMap.delete(oldestKey)
  }
}

export async function getGptReply(prompt, conversationId) {
  console.log('🚀🚀🚀 / prompt', prompt)

  // 清理过期的会话
  cleanConversationMap()

  // 获取当前会话的上下文消息
  let conversation = conversationMap.get(conversationId)
  let messages = []
  if (conversation) {
    messages = conversation.messages
  }

  // 添加新的用户消息
  messages.push({ role: 'user', content: prompt })

  // 只保留最近的两条消息（用户和助手各一条）
  messages = messages.slice(-2)

  // 如果有系统消息，添加到消息的最前面
  if (env.OPENAI_SYSTEM_MESSAGE) {
    messages.unshift({ role: 'system', content: env.OPENAI_SYSTEM_MESSAGE })
  }

  const response = await openai.chat.completions.create({
    messages: messages,
    model: chosen_model,
  })
  console.log('🚀🚀🚀 / reply', response.choices[0].message.content)

  // 将助手的回复添加到上下文中
  messages.push({ role: 'assistant', content: response.choices[0].message.content })
  // 只保留最近的两条消息
  messages = messages.slice(-2)

  // 更新会话上下文
  conversationMap.set(conversationId, { messages: messages, timestamp: Date.now() })

  return `${response.choices[0].message.content}\nVia ${chosen_model}`
}

