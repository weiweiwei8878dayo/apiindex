import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

type Bindings = {
  DATABASE_URL: string
  DISCORD_TOKEN: string
  ADMIN_SECRET: string // Webからの操作用の合言葉
}

const app = new Hono<{ Bindings: Bindings }>()
app.use('/*', cors())

// セキュリティミドルウェア: ヘッダーに正しい合言葉がないと拒絶
app.use('/admin/*', async (c, next) => {
  const secret = c.req.header('X-Admin-Secret')
  if (secret !== c.env.ADMIN_SECRET) return c.json({ error: 'Unauthorized' }, 401)
  await next()
})

const getPrisma = (url: string) => {
  const pool = new Pool({ connectionString: url, ssl: false })
  return new PrismaClient({ adapter: new PrismaPg(pool) })
}

// 1. 統計・注文取得
app.get('/admin/stats', async (c) => {
  const prisma = getPrisma(c.env.DATABASE_URL)
  const orders = await prisma.order.findMany({ orderBy: { createdAt: 'desc' } })
  const config = await prisma.config.findFirst({ where: { id: 1 } })
  return c.json({ orders, isShopOpen: (config as any)?.isShopOpen ?? true })
})

// 2. Webからユーザーへメッセージ送信 (Discord REST APIを使用)
app.post('/admin/send-message', async (c) => {
  const { userId, message } = await c.req.json()
  const res = await fetch(`https://discord.com/api/v10/users/@me/channels`, {
    method: 'POST',
    headers: { Authorization: `Bot ${c.env.DISCORD_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient_id: userId })
  })
  const channel = await res.json() as any
  
  await fetch(`https://discord.com/api/v10/channels/${channel.id}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${c.env.DISCORD_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: `【管理者からのメッセージ】\n${message}` })
  })
  return c.json({ success: true })
})

// 3. 完了通知（スクショは外部URLまたは簡易送信）
// ※本格的な画像アップロードはCloudflare R2が必要ですが、ここではテキストメッセージのみ例示
app.post('/admin/complete', async (c) => {
  const prisma = getPrisma(c.env.DATABASE_URL)
  const { id, userId } = await c.req.json()
  
  // DB更新
  await prisma.order.update({ where: { id }, data: { status: 'completed', completedAt: new Date() } })
  
  // Discordへ通知 (実績ボタン付きで送るにはGCP Bot経由が楽なため、ここではステータス更新のみ)
  return c.json({ success: true })
})

export default app
