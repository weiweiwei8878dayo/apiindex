import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

type Bindings = {
  DATABASE_URL: string
}

const app = new Hono<{ Bindings: Bindings }>()
app.use('/*', cors())

const getPrisma = (databaseUrl: string) => {
  if (!databaseUrl) {
    throw new Error("DATABASE_URLが設定されていません。CloudflareのSettingsを確認してください。");
  }

  // 先頭や末尾の空白、クォーテーションを強制削除
  const cleanUrl = databaseUrl.trim().replace(/^["']|["']$/g, '');

  const pool = new Pool({ 
    connectionString: cleanUrl,
    ssl: {
      rejectUnauthorized: false
    },
    connectionTimeoutMillis: 10000,
  })
  
  const adapter = new PrismaPg(pool)
  return new PrismaClient({ adapter })
}

app.get('/', (c) => c.text(`API稼働中`))

app.get('/admin/stats', async (c) => {
  try {
    const prisma = getPrisma(c.env.DATABASE_URL)
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
    console.error("DB_ERROR:", e.message)
    // エラーメッセージを画面に出して原因を特定しやすくする
    return c.json({ error: "接続エラー: " + e.message }, 500)
  }
})

app.post('/admin/toggle-shop', async (c) => {
  try {
    const prisma = getPrisma(c.env.DATABASE_URL)
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
  try {
    const prisma = getPrisma(c.env.DATABASE_URL)
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
