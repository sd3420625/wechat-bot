import dotenv from 'dotenv'
// 加载环境变量
dotenv.config()
const env = dotenv.config().parsed // 环境参数

// 从环境变量中导入机器人的名称
const botName = env.BOT_NAME

// 从环境变量中导入需要自动回复的消息前缀，默认配空串或不配置则等于无前缀
const autoReplyPrefix = env.AUTO_REPLY_PREFIX ? env.AUTO_REPLY_PREFIX : ''

// 从环境变量中导入联系人白名单
const aliasWhiteList = env.ALIAS_WHITELIST ? env.ALIAS_WHITELIST.split(',') : []

// 从环境变量中导入群聊白名单
const roomWhiteList = env.ROOM_WHITELIST ? env.ROOM_WHITELIST.split(',') : []

// 从环境变量中导入语音群聊白名单
const voiceRoomWhiteList = env.VOICE_ROOM_WHITELIST ? env.VOICE_ROOM_WHITELIST.split(',') : []

import { getServe } from './serve.js'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import NodeCache from 'node-cache'
import { Readable } from 'stream'
import ffmpeg from 'ffmpeg-static'
import { spawn } from 'child_process'
import vosk from 'vosk'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 会话缓存，最大容量10，过期时间30分钟
const conversationCache = new NodeCache({ stdTTL: 1800, checkperiod: 600, maxKeys: 10 })

// Vosk 模型路径
const modelPath = path.join(__dirname, '../voice/model/vosk-model-small-cn')

// 检查 Vosk 模型是否存在
if (!fs.existsSync(modelPath)) {
  console.error('❌ Vosk 模型不存在，请检查路径:', modelPath)
  process.exit(1)
}

// 加载 Vosk 模型
vosk.setLogLevel(0)
const model = new vosk.Model(modelPath)

/**
 * 默认消息发送
 * @param msg
 * @param bot
 * @param ServiceType 服务类型 'GPT' | 'Kimi'
 * @returns {Promise<void>}
 */
export async function defaultMessage(msg, bot, ServiceType = 'GPT') {
  const getReply = getServe(ServiceType)
  const contact = msg.talker() // 发消息人
  const content = msg.text() // 消息内容
  const room = msg.room() // 是否是群消息
  const roomName = (await room?.topic()) || null // 群名称
  const alias = (await contact.alias()) || (await contact.name()) // 发消息人昵称
  const remarkName = await contact.alias() // 备注名称
  const name = await contact.name() // 微信名称
  const isText = msg.type() === bot.Message.Type.Text // 消息类型是否为文本
  const isVoice = msg.type() === bot.Message.Type.Audio || msg.type() === bot.Message.Type.Voice // 是否为语音消息
  const isRoom = room && roomWhiteList.includes(roomName) && content.includes(`${botName}`) // 是否在群聊白名单内并且艾特了机器人
  const isAlias = aliasWhiteList.includes(remarkName) || aliasWhiteList.includes(name) // 发消息的人是否在联系人白名单内
  const isVoiceRoom = room && voiceRoomWhiteList.includes(roomName) // 是否在语音群聊白名单内
  const isBotSelf = botName === remarkName || botName === name // 是否是机器人自己

  if (isBotSelf) return // 如果是机器人自己发送的消息则不处理

  try {
    // 处理文本消息
    if (isText) {
      // 群聊
      if (isRoom && content.replace(`${botName}`, '').trimStart().startsWith(`${autoReplyPrefix}`)) {
        const question = (await msg.mentionText()) || content.replace(`${botName}`, '').replace(`${autoReplyPrefix}`, '') // 去掉艾特的消息主体
        console.log('🌸🌸🌸 / question: ', question)
        const conversationId = room.id // 使用群聊 ID 作为会话 ID
        const response = await getReply(question, conversationId)
        await room.say(response)
      }
      // 私聊
      if (isAlias && !room && content.trimStart().startsWith(`${autoReplyPrefix}`)) {
        const question = content.replace(`${autoReplyPrefix}`, '')
        console.log('🌸🌸🌸 / content: ', question)
        const conversationId = contact.id // 使用联系人 ID 作为会话 ID
        const response = await getReply(question, conversationId)
        await contact.say(response)
      }
    }
    // 处理语音消息
    else if (isVoice) {
      const fileBox = await msg.toFileBox()
      const fileName = fileBox.name
      const tmpDir = path.join(__dirname, '../voice/tmp')
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true })
      }
      const amrPath = path.join(tmpDir, fileName)

      // 保存语音文件
      await fileBox.toFile(amrPath, true)

      // 转换为 PCM 格式
      const audioStream = fs.createReadStream(amrPath)
      const command = ffmpeg
      const args = [
        '-loglevel', 'quiet',
        '-i', 'pipe:0',
        '-ar', '16000',
        '-ac', '1',
        '-f', 's16le',
        'pipe:1'
      ]
      const ffmpegProcess = spawn(command, args, { stdio: ['pipe', 'pipe', 'ignore'] })
      audioStream.pipe(ffmpegProcess.stdin)

      const rec = new vosk.Recognizer({ model: model, sampleRate: 16000 })
      ffmpegProcess.stdout.on('data', (chunk) => {
        rec.acceptWaveform(chunk)
      })

      ffmpegProcess.stdout.on('end', async () => {
        const result = rec.finalResult()
        console.log('🌸🌸🌸 / Vosk 识别结果: ', result.text)
        const question = result.text

        // 群聊语音消息
        if (isVoiceRoom) {
          const conversationId = room.id // 使用群聊 ID 作为会话 ID
          const response = await getReply(question, conversationId)
          await room.say(response)
        }
        // 私聊语音消息
        else if (isAlias && !room) {
          const conversationId = contact.id // 使用联系人 ID 作为会话 ID
          const response = await getReply(question, conversationId)
          await contact.say(response)
        }

        // 删除临时文件
        fs.unlinkSync(amrPath)
        // 释放资源
        rec.free()
      })

      ffmpegProcess.on('error', (e) => {
        console.error('❌ ffmpeg 转换失败:', e)
        fs.unlinkSync(amrPath)
        rec.free()
      })

      ffmpegProcess.on('close', (code) => {
        if (code !== 0) {
          console.error(`❌ ffmpeg 进程退出，退出码 ${code}`)
          fs.unlinkSync(amrPath)
          rec.free()
        }
      })
    }
  } catch (e) {
    console.error(e)
  }
}

