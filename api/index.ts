import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { PrismaClient } from '@prisma/client/edge'
import { withAccelerate } from '@prisma/extension-accelerate'

const app = new Hono<{ Bindings: { DATABASE_URL: string } }>()

// セキュリティのためにCORSを設定（自分のPagesのURLだけ許可するのがベスト）
app.use('/*', cors())

// 1. ダッシュボード情報の取得（売上、注文、ショップ状態）
app.get('/admin/stats', async (c) => {
  const prisma = new PrismaClient({ datasourceUrl: c.env.DATABASE_URL }).$extends(withAccelerate())
  
  const orders = await prisma.order.findMany({ orderBy: { createdAt: 'desc' } })
  const config = await prisma.config.findFirst({ where: { id: 1 } })
  
  // 今日の売上計算
  const today = new Date().setHours(0,0,0,0)
  const todaySales = orders
    .filter(o => new Date(o.createdAt).getTime() > today)
    .reduce((sum, o) => sum + o.totalPrice, 0)

  return c.json({
    orders,
    isShopOpen: config?.isShopOpen ?? true,
    todaySales,
    pendingCount: orders.filter(o => o.status === 'pending').length
  })
})

// 2. 受付状態の切り替え
app.post('/admin/toggle-shop', async (c) => {
  const prisma = new PrismaClient({ datasourceUrl: c.env.DATABASE_URL }).$extends(withAccelerate())
  const { open } = await c.req.json()
  await prisma.config.update({ where: { id: 1 }, data: { isShopOpen: open } })
  return c.json({ success: true })
})

// 3. 個人情報（引き継ぎコード等）の抹消
app.post('/admin/scrub-order', async (c) => {
  const prisma = new PrismaClient({ datasourceUrl: c.env.DATABASE_URL }).$extends(withAccelerate())
  const { id } = await c.req.json()
  await prisma.order.update({
    where: { id },
    data: { transferCode: "抹消済み", authPassword: "抹消済み" }
  })
  return c.json({ success: true })
})

export default app
