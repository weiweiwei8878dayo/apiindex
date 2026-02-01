import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Client } from 'pg'

type Bindings = {
  DATABASE_URL: string
}

const app = new Hono<{ Bindings: Bindings }>()
app.use('/*', cors())

// PrismaClientを初期化する関数
const getPrisma = (databaseUrl: string) => {
  const client = new Client({ connectionString: databaseUrl })
  const adapter = new PrismaPg(client)
  return new PrismaClient({ adapter })
}

app.get('/', (c) => c.json({ message: "API稼働中" }))

app.get('/admin/stats', async (c) => {
  const prisma = getPrisma(c.env.DATABASE_URL)
  try {
    const orders = await prisma.order.findMany({ orderBy: { createdAt: 'desc' } })
    const config = await prisma.config.findFirst({ where: { id: 1 } })
    return c.json({ orders, isShopOpen: (config as any)?.isShopOpen ?? true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
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
  }
})

export default app
