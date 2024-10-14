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

// 定义一个 Map 来存储会话上下文，最多保存 10 个会话
const conversationMap = new Map()
const MAX_CONVERSATIONS = 10

export async function getGptReply(prompt, conversationId) {
  console.log('🚀🚀🚀 / prompt', prompt)

  // 检查当前会话是否存在，不存在则创建
  if (!conversationMap.has(conversationId)) {
    conversationMap.set(conversationId, [])
  }

  // 如果会话数超过最大值，删除最早的会话
  if (conversationMap.size > MAX_CONVERSATIONS) {
    const oldestConversationId = conversationMap.keys().next().value
    conversationMap.delete(oldestConversationId)
  }

  // 获取当前会话的消息
  let messages = conversationMap.get(conversationId)

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
  conversationMap.set(conversationId, messages)

  return `${response.choices[0].message.content}\nVia ${chosen_model}`
}

