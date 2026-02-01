import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { PrismaClient } from '@prisma/client/edge'

const app = new Hono<{ Bindings: { DATABASE_URL: string } }>()

app.use('/*', cors())

// WorkersのURLを直接叩いた時に「生きてるよ」と表示させる
app.get('/', (c) => c.text('代行Bot APIは正常に稼働しています。接続先: ' + c.req.url))

// ステータス取得
app.get('/admin/stats', async (c) => {
  const prisma = new PrismaClient({ datasourceUrl: c.env.DATABASE_URL })
  try {
    const orders = await prisma.order.findMany({ orderBy: { createdAt: 'desc' } })
    const config = await prisma.config.findFirst({ where: { id: 1 } })
    
    const today = new Date().setHours(0,0,0,0)
    const todaySales = orders
      .filter(o => o.status === 'completed' && new Date(o.createdAt).getTime() > today)
      .reduce((sum, o) => sum + (o.totalPrice || 0), 0)

    return c.json({ orders, isShopOpen: (config as any)?.isShopOpen ?? true, todaySales })
  } catch (e: any) {
    console.error(e)
    return c.json({ error: "DB接続エラー: " + e.message }, 500)
  } finally {
    await prisma.$disconnect()
  }
})

// 以下、toggle-shopとscrubは以前のまま
app.post('/admin/toggle-shop', async (c) => {
    const prisma = new PrismaClient({ datasourceUrl: c.env.DATABASE_URL })
    const { open } = await c.req.json()
    await (prisma.config as any).upsert({ where: { id: 1 }, update: { isShopOpen: open }, create: { id: 1, isShopOpen: open } })
    return c.json({ success: true })
})

app.post('/admin/scrub', async (c) => {
    const prisma = new PrismaClient({ datasourceUrl: c.env.DATABASE_URL })
    const { id } = await c.req.json()
    await prisma.order.update({ where: { id: Number(id) }, data: { transferCode: "SCRUBBED", authPassword: "HIDDEN" } })
    return c.json({ success: true })
})

export default app
