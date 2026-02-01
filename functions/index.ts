import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg' // Client ではなく Pool をインポート

type Bindings = {
  DATABASE_URL: string
}

const app = new Hono<{ Bindings: Bindings }>()
app.use('/*', cors())

// Prismaインスタンスを作成する関数
const getPrisma = (databaseUrl: string) => {
  // connectionString を使って Pool を作成
  const pool = new Pool({ connectionString: databaseUrl })
  // Pool をアダプターに渡す
  const adapter = new PrismaPg(pool)
  return new PrismaClient({ adapter })
}

app.get('/', (c) => c.json({ message: "API稼働中" }))

app.get('/admin/stats', async (c) => {
  const prisma = getPrisma(c.env.DATABASE_URL)
  try {
    const orders = await prisma.order.findMany({ orderBy: { createdAt: 'desc' } })
    const config = await prisma.config.findFirst({ where: { id: 1 } })
    
    return c.json({
      orders,
      isShopOpen: (config as any)?.isShopOpen ?? true,
      todaySales: orders
        .filter(o => o.status === 'completed')
        .reduce((sum, o) => sum + (o.totalPrice || 0), 0)
    })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  } finally {
    await prisma.$disconnect()
  }
})

app.post('/admin/toggle-shop', async (c) => {
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

app.post('/admin/scrub', async (c) => {
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

export default app
