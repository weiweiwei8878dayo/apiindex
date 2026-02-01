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
 * DB接続用の関数 (SSL無効化とアダプター設定)
 */
const getPrisma = (url: string) => {
  const pool = new Pool({ 
    connectionString: url.trim().replace(/^["']|["']$/g, ''), 
    ssl: false // GCP外部接続用にSSLをオフにする
  })
  const adapter = new PrismaPg(pool)
  return new PrismaClient({ adapter })
}

// 認証チェックAPI
app.post('/api/auth', async (c) => {
  try {
    const { password } = await c.req.json()
    if (password === c.env.ADMIN_PASSWORD) return c.json({ success: true })
    return c.json({ success: false }, 401)
  } catch (e) {
    return c.json({ error: "Invalid Request" }, 400)
  }
})

// 管理者API: 統計と注文取得
app.get('/api/admin/stats', async (c) => {
  const pw = c.req.header('Authorization')
  if (pw !== c.env.ADMIN_PASSWORD) return c.json({ error: 'Unauthorized' }, 401)

  const prisma = getPrisma(c.env.DATABASE_URL)
  try {
    const orders = await prisma.order.findMany({ orderBy: { createdAt: 'desc' } })
    const config = await prisma.config.findFirst({ where: { id: 1 } })
    
    return c.json({ 
      orders, 
      isShopOpen: (config as any)?.isShopOpen ?? true 
    })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  } finally {
    await prisma.$disconnect()
  }
})

// 管理者API: ステータス更新
app.post('/api/admin/update-status', async (c) => {
  const pw = c.req.header('Authorization')
  if (pw !== c.env.ADMIN_PASSWORD) return c.json({ error: 'Unauthorized' }, 401)

  const prisma = getPrisma(c.env.DATABASE_URL)
  try {
    const { id, status } = await c.req.json()
    await prisma.order.update({
      where: { id: Number(id) },
      data: { status }
    })
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  } finally {
    await prisma.$disconnect()
  }
})

// 管理者API: 情報抹消
app.post('/api/admin/scrub', async (c) => {
  const pw = c.req.header('Authorization')
  if (pw !== c.env.ADMIN_PASSWORD) return c.json({ error: 'Unauthorized' }, 401)

  const prisma = getPrisma(c.env.DATABASE_URL)
  try {
    const { id } = await c.req.json()
    await prisma.order.update({
      where: { id: Number(id) },
      data: { transferCode: "SCRUBBED", authPassword: "HIDDEN" }
    })
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  } finally {
    await prisma.$disconnect()
  }
})

// 管理者API: 受付停止切り替え
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
