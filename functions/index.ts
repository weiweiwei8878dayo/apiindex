import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

type Bindings = {
  DATABASE_URL: string
  ADMIN_PASSWORD: string
}

const app = new Hono<{ Bindings: Bindings }>()

// 【重要】CORS設定を強化（これで通信エラーを防ぐ）
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

const getPrisma = (url: string) => {
  const pool = new Pool({ connectionString: url.trim().replace(/^["']|["']$/g, ''), ssl: false })
  return new PrismaClient({ adapter: new PrismaPg(pool) })
}

// 認証API
app.post('/api/auth', async (c) => {
  const body = await c.req.json()
  if (body.password === c.env.ADMIN_PASSWORD) {
    return c.json({ success: true })
  }
  return c.json({ success: false }, 401)
})

// 管理者用API（ステータス取得・更新）
app.get('/api/admin/stats', async (c) => {
  const pw = c.req.header('Authorization')
  if (pw !== c.env.ADMIN_PASSWORD) return c.json({ error: 'Unauthorized' }, 401)

  const prisma = getPrisma(c.env.DATABASE_URL)
  const orders = await prisma.order.findMany({ orderBy: { createdAt: 'desc' } })
  const config = await prisma.config.findFirst({ where: { id: 1 } })
  return c.json({ orders, isShopOpen: (config as any)?.isShopOpen ?? true })
})

// ステータス更新（進行中・完了など）
app.post('/api/admin/update-status', async (c) => {
  const pw = c.req.header('Authorization')
  if (pw !== c.env.ADMIN_PASSWORD) return c.json({ error: 'Unauthorized' }, 401)

  const prisma = getPrisma(c.env.DATABASE_URL)
  const { id, status } = await c.req.json()
  await prisma.order.update({
    where: { id: Number(id) },
    data: { 
      status: status,
      completedAt: status === 'completed' ? new Date() : undefined
    }
  })
  return c.json({ success: true })
})

// 個人情報抹消
app.post('/api/admin/scrub', async (c) => {
  const pw = c.req.header('Authorization')
  if (pw !== c.env.ADMIN_PASSWORD) return c.json({ error: 'Unauthorized' }, 401)

  const prisma = getPrisma(c.env.DATABASE_URL)
  const { id } = await c.req.json()
  await prisma.order.update({
    where: { id: Number(id) },
    data: { transferCode: "抹消済み", authPassword: "抹消済み" }
  })
  return c.json({ success: true })
})

export default app
