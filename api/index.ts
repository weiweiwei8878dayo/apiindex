import { Hono } from 'hono'
import { PrismaClient } from '@prisma/client/edge'
import { withAccelerate } from '@prisma/extension-accelerate'

const app = new Hono()

// 注文一覧取得
app.get('/admin/orders', async (c) => {
  const prisma = new PrismaClient({ datasourceUrl: c.env.DATABASE_URL }).$extends(withAccelerate())
  const orders = await prisma.order.findMany({ orderBy: { createdAt: 'desc' } })
  return c.json(orders)
})

// 受付停止・再開切り替え
app.post('/admin/shop-toggle', async (c) => {
  const prisma = new PrismaClient({ datasourceUrl: c.env.DATABASE_URL }).$extends(withAccelerate())
  const { open } = await c.req.json()
  await prisma.config.update({ where: { id: 1 }, data: { isShopOpen: open } })
  return c.json({ success: true })
})

// 個人情報（引き継ぎコード）の削除
app.post('/admin/order/scrub', async (c) => {
  const prisma = new PrismaClient({ datasourceUrl: c.env.DATABASE_URL }).$extends(withAccelerate())
  const { id } = await c.req.json()
  await prisma.order.update({
    where: { id },
    data: { transferCode: "SCRUBBED", authPassword: "HIDDEN" }
  })
  return c.json({ success: true })
})

export default app