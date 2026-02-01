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

// PrismaClientを初期化する関数
const getPrisma = (databaseUrl: string) => {
  try {
    // URLから接続情報を分解
    const url = new URL(databaseUrl);
    
    const pool = new Pool({ 
      host: url.hostname,
      port: parseInt(url.port || "5432"),
      user: url.username,
      password: url.password,
      database: url.pathname.slice(1),
      ssl: {
        rejectUnauthorized: false
      },
      // タイムアウト設定
      connectionTimeoutMillis: 10000,
    })
    
    const adapter = new PrismaPg(pool)
    return new PrismaClient({ adapter })
  } catch (e) {
    throw new Error("DATABASE_URLの形式が正しくありません。");
  }
}

app.get('/', (c) => c.text(`API稼働中: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`))

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
    console.error("DB_ERROR:", e.message)
    return c.json({ error: "DB接続エラー: " + e.message }, 500)
  } finally {
    await prisma.$disconnect()
  }
})

// toggle-shop と scrub は以前のまま getPrisma を使う形に
app.post('/admin/toggle-shop', async (c) => {
  const prisma = getPrisma(c.env.DATABASE_URL)
  try {
    const { open } = await c.req.json()
    await (prisma.config as any).upsert({ where: { id: 1 }, update: { isShopOpen: open }, create: { id: 1, isShopOpen: open } })
    return c.json({ success: true })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
  finally { await prisma.$disconnect() }
})

app.post('/admin/scrub', async (c) => {
  const prisma = getPrisma(c.env.DATABASE_URL)
  try {
    const { id } = await c.req.json()
    await prisma.order.update({ where: { id: Number(id) }, data: { transferCode: "SCRUBBED", authPassword: "HIDDEN" } })
    return c.json({ success: true })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
  finally { await prisma.$disconnect() }
})

export default app
