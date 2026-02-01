import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { PrismaClient } from '@prisma/client/edge'

const app = new Hono<{ Bindings: { DATABASE_URL: string } }>()

// すべてのオリジンからのアクセスを許可
app.use('/*', cors())

// ルートパス
app.get('/', (c) => c.json({ message: "API稼働中" }))

// 統計取得
app.get('/admin/stats', async (c) => {
  const prisma = new PrismaClient({ datasourceUrl: c.env.DATABASE_URL })
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

// ショップ切り替え
app.post('/admin/toggle-shop', async (c) => {
  const prisma = new PrismaClient({ datasourceUrl: c.env.DATABASE_URL })
  const { open } = await c.req.json()
  await (prisma.config as any).upsert({ where: { id: 1 }, update: { isShopOpen: open }, create: { id: 1, isShopOpen: open } })
  return c.json({ success: true })
})

// 抹消
app.post('/admin/scrub', async (c) => {
  const prisma = new PrismaClient({ datasourceUrl: c.env.DATABASE_URL })
  const { id } = await c.req.json()
  await prisma.order.update({ where: { id: Number(id) }, data: { transferCode: "SCRUBBED", authPassword: "HIDDEN" } })
  return c.json({ success: true })
})

export default app
