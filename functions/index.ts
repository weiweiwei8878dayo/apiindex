import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

type Bindings = {
  DATABASE_URL: string
  ADMIN_PASSWORD: string // 管理画面のログインパスワード
  DISCORD_TOKEN: string
}

const app = new Hono<{ Bindings: Bindings }>()
app.use('/*', cors())

const getPrisma = (url: string) => {
  const pool = new Pool({ connectionString: url.trim().replace(/^["']|["']$/g, ''), ssl: false })
  return new PrismaClient({ adapter: new PrismaPg(pool) })
}

// 認証チェック
app.post('/api/auth', async (c) => {
  const { password } = await c.req.json()
  if (password === c.env.ADMIN_PASSWORD) return c.json({ success: true, token: c.env.ADMIN_PASSWORD })
  return c.json({ success: false }, 401)
})

// 認証ミドルウェア
app.use('/api/admin/*', async (c, next) => {
  const token = c.req.header('Authorization')
  if (token !== c.env.ADMIN_PASSWORD) return c.json({ error: 'Unauthorized' }, 401)
  await next()
})

// 注文一覧取得（全項目）
app.get('/api/admin/stats', async (c) => {
  const prisma = getPrisma(c.env.DATABASE_URL)
  const orders = await prisma.order.findMany({ orderBy: { createdAt: 'desc' } })
  const config = await prisma.config.findFirst({ where: { id: 1 } })
  return c.json({ orders, isShopOpen: (config as any)?.isShopOpen ?? true })
})

// 個人情報抹消
app.post('/api/admin/scrub', async (c) => {
  const prisma = getPrisma(c.env.DATABASE_URL)
  const { id } = await c.req.json()
  await prisma.order.update({
    where: { id: Number(id) },
    data: { transferCode: "抹消済", authPassword: "抹消済" }
  })
  return c.json({ success: true })
})

// ショップ切り替え
app.post('/api/admin/toggle', async (c) => {
  const prisma = getPrisma(c.env.DATABASE_URL)
  const { open } = await c.req.json()
  await (prisma.config as any).upsert({ where: { id: 1 }, update: { isShopOpen: open }, create: { id: 1, isShopOpen: open } })
  return c.json({ success: true })
})

export default app
