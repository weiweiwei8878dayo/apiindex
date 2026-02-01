import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { PrismaClient } from '@prisma/client/edge'

// Cloudflare Workersの環境変数(DATABASE_URL)を型定義
type Bindings = {
  DATABASE_URL: string
}

const app = new Hono<{ Bindings: Bindings }>()

// 管理画面(Pages)からのアクセスを許可
app.use('/*', cors())

// 1. ダッシュボード情報の取得
app.get('/admin/stats', async (c) => {
  const prisma = new PrismaClient({ datasourceUrl: c.env.DATABASE_URL })
  
  try {
    const orders = await prisma.order.findMany({ orderBy: { createdAt: 'desc' } })
    const config = await prisma.config.findFirst({ where: { id: 1 } })
    
    // 今日の売上計算 (日本時間考慮なしの簡易版)
    const today = new Date().setHours(0,0,0,0)
    const todaySales = orders
      .filter(o => new Date(o.createdAt).getTime() > today)
      .reduce((sum, o) => sum + (o.totalPrice || 0), 0)

    return c.json({
      orders,
      isShopOpen: (config as any)?.isShopOpen ?? true, // 型エラー回避
      todaySales,
      pendingCount: orders.filter(o => o.status === 'pending').length
    })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  } finally {
    await prisma.$disconnect()
  }
})

// 2. 受付状態の切り替え
app.post('/admin/toggle-shop', async (c) => {
  const prisma = new PrismaClient({ datasourceUrl: c.env.DATABASE_URL })
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

// 3. 個人情報（引き継ぎコード等）の抹消
app.post('/admin/scrub', async (c) => {
  const prisma = new PrismaClient({ datasourceUrl: c.env.DATABASE_URL })
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
