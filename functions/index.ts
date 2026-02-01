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

// CORS設定：管理画面からの接続を許可
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

// 1. 生存確認用
app.get('/', (c) => c.text("API is running"))

// 2. ログイン認証API ( /auth に変更 )
app.post('/auth', async (c) => {
  try {
    const { password } = await c.req.json()
    if (password === c.env.ADMIN_PASSWORD) return c.json({ success: true })
    return c.json({ success: false }, 401)
  } catch (e) {
    return c.json({ error: "Invalid Request" }, 400)
  }
})

// 3. 注文一覧・ステータス取得 ( /admin/stats に修正 )
app.get('/admin/stats', async (c) => {
  const pw = c.req.header('Authorization')
  if (pw !== c.env.ADMIN_PASSWORD) return c.json({ error: 'Unauthorized' }, 401)

  const prisma = getPrisma(c.env.DATABASE_URL)
  try {
    const orders = await prisma.order.findMany({ orderBy: { createdAt: 'desc' } })
    const config = await prisma.config.findFirst({ where: { id: 1 } })
    
    // 今日の売上計算 (日本時間)
    const now = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Tokyo"}));
    const todayStr = now.toDateString();
    const todaySales = orders
      .filter(o => o.status === 'completed' && new Date(o.createdAt).toDateString() === todayStr)
      .reduce((sum, o) => sum + (o.totalPrice || 0), 0)

    return c.json({ orders, isShopOpen: (config as any)?.isShopOpen ?? true, todaySales })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  } finally {
    await prisma.$disconnect()
  }
})

// 4. ステータス変更 ( /admin/update-status に修正 )
app.post('/admin/update-status', async (c) => {
  const pw = c.req.header('Authorization')
  if (pw !== c.env.ADMIN_PASSWORD) return c.json({ error: 'Unauthorized' }, 401)

  const prisma = getPrisma(c.env.DATABASE_URL)
  try {
    const { id, status } = await c.req.json()
    await prisma.order.update({
      where: { id: Number(id) },
      data: { status: status, completedAt: status === 'completed' ? new Date() : undefined }
    })
    return c.json({ success: true })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
  finally { await prisma.$disconnect() }
})

// 5. 個人情報抹消 ( /admin/scrub に修正 )
app.post('/admin/scrub', async (c) => {
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
  } catch (e: any) { return c.json({ error: e.message }, 500) }
  finally { await prisma.$disconnect() }
})

// 6. ショップ切り替え ( /admin/toggle に修正 )
app.post('/admin/toggle', async (c) => {
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
  } catch (e: any) { return c.json({ error: e.message }, 500) }
  finally { await prisma.$disconnect() }
})

export default app
