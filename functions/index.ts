import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

type Bindings = {
  DATABASE_URL: string
}

const app = new Hono<{ Bindings: Bindings }>()

// CORS設定: 管理画面(Pages)からのアクセスを許可
app.use('/*', cors())

// PrismaClientを初期化する共通関数
const getPrisma = (databaseUrl: string) => {
  const pool = new Pool({ 
    connectionString: databaseUrl,
    // 【最重要】外部IPへの接続ではSSL証明書エラーを防ぐためにこれが必要
    ssl: {
      rejectUnauthorized: false
    },
    // 接続の安定化設定
    max: 10,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
  })
  const adapter = new PrismaPg(pool)
  return new PrismaClient({ adapter })
}

// 1. Workersの死活監視用
app.get('/', (c) => c.text(`API稼働中: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`))

// 2. ダッシュボード情報の取得 (注文一覧・売上・ショップ状態)
app.get('/admin/stats', async (c) => {
  const prisma = getPrisma(c.env.DATABASE_URL)
  try {
    const orders = await prisma.order.findMany({ orderBy: { createdAt: 'desc' } })
    const config = await prisma.config.findFirst({ where: { id: 1 } })
    
    // 今日の売上計算
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todaySales = orders
      .filter(o => o.status === 'completed' && new Date(o.createdAt) >= today)
      .reduce((sum, o) => sum + (o.totalPrice || 0), 0)

    return c.json({
      orders,
      isShopOpen: (config as any)?.isShopOpen ?? true, // 型エラー回避
      todaySales,
      pendingCount: orders.filter(o => o.status === 'pending').length
    })
  } catch (e: any) {
    console.error("STATS_ERROR:", e.message)
    return c.json({ error: "DB接続エラー: " + e.message }, 500)
  } finally {
    await prisma.$disconnect()
  }
})

// 3. 受付状態の切り替え (OPEN / CLOSED)
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

// 4. 個人情報 (引き継ぎコード等) の抹消
app.post('/admin/scrub', async (c) => {
  const prisma = getPrisma(c.env.DATABASE_URL)
  try {
    const { id } = await c.req.json()
    await prisma.order.update({
      where: { id: Number(id) },
      data: { 
        transferCode: "SCRUBBED", 
        authPassword: "HIDDEN" 
      }
    })
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  } finally {
    await prisma.$disconnect()
  }
})

export default app
