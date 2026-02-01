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

// CORS設定
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

/**
 * データベース接続用関数
 */
const getPrisma = (url: string) => {
  const cleanUrl = url.trim().replace(/^["']|["']$/g, '');
  const pool = new Pool({ 
    connectionString: cleanUrl,
    ssl: false // GCP外部接続用にSSLをオフ
  })
  const adapter = new PrismaPg(pool)
  return new PrismaClient({ adapter })
}

// 1. ログイン認証API
app.post('/api/auth', async (c) => {
  const body = await c.req.json()
  if (body.password === c.env.ADMIN_PASSWORD) {
    return c.json({ success: true })
  }
  return c.json({ success: false }, 401)
})

// 2. 注文一覧・ステータス取得
app.get('/api/admin/stats', async (c) => {
  const pw = c.req.header('Authorization')
  if (pw !== c.env.ADMIN_PASSWORD) return c.json({ error: 'Unauthorized' }, 401)

  const prisma = getPrisma(c.env.DATABASE_URL)
  try {
    const orders = await prisma.order.findMany({ orderBy: { createdAt: 'desc' } })
    const config = await prisma.config.findFirst({ where: { id: 1 } })
    return c.json({ orders, isShopOpen: (config as any)?.isShopOpen ?? true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  } finally {
    await prisma.$disconnect()
  }
})

// 3. ステータス変更 (未着手/進行中/完了)
app.post('/api/admin/update-status', async (c) => {
  const pw = c.req.header('Authorization')
  if (pw !== c.env.ADMIN_PASSWORD) return c.json({ error: 'Unauthorized' }, 401)

  const prisma = getPrisma(c.env.DATABASE_URL)
  try {
    const { id, status } = await c.req.json()
    await prisma.order.update({
      where: { id: Number(id) },
      data: { 
        status: status,
        completedAt: status === 'completed' ? new Date() : undefined
      }
    })
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  } finally {
    await prisma.$disconnect()
  }
})

// 4. 個人情報抹消
app.post('/api/admin/scrub', async (c) => {
  const pw = c.req.header('Authorization')
  if (pw !== c.env.ADMIN_PASSWORD) return c.json({ error: 'Unauthorized' }, 401)

  const prisma = getPrisma(c.env.DATABASE_URL)
  try {
    const { id } = await c.req.json()
    await prisma.order.update({
      where: { id: Number(id) },
      data: { transferCode: "抹消済み", authPassword: "抹消済み" }
    })
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  } finally {
    await prisma.$disconnect()
  }
})

// 5. ショップの受付停止・再開
app.post('/api/admin/toggle', async (c) => {
  const pw = c.req.header('Authorization')
  if (pw !== c.env.ADMIN_PASSWORD) return c.json({ error: 'Unauthorized' }, 401)

  const prisma = getPrisma(c.env.DATABASE_URL)
  try {
    const { open } = await c.req.json()
    await (prisma.config as any).upsert({
      where: { id: 1 },
      update: { isShopOpen: open },
      create: { id: 1, isShopOpen: open }
    })
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  } finally {
    await prisma.$disconnect()
  }
})

export default app
