import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

type Bindings = {
  DATABASE_URL: string
}

const app = new Hono<{ Bindings: Bindings }>()

// 管理画面(Pages)からの通信を許可
app.use('/*', cors())

/**
 * Prismaインスタンスを安全に作成する関数
 */
const createPrisma = (databaseUrl: string) => {
  // 文字列の前後にある余計なクォーテーションや空白を徹底的に消去
  const cleanUrl = databaseUrl.trim().replace(/^["']|["']$/g, '');
  
  const pool = new Pool({ 
    connectionString: cleanUrl,
    ssl: { rejectUnauthorized: false }, // 自己署名証明書の接続を許可
    connectionTimeoutMillis: 10000,
  })
  
  const adapter = new PrismaPg(pool)
  return new PrismaClient({ adapter })
}

// 1. 生存確認用
app.get('/', (c) => c.text("API is running"))

// 2. 管理用データ取得
app.get('/admin/stats', async (c) => {
  const url = c.env.DATABASE_URL;

  // 環境変数がない場合のデバッグ表示
  if (!url) {
    return c.json({ 
      error: "DATABASE_URLが設定されていません。",
      detected_vars: Object.keys(c.env) 
    }, 500);
  }

  const prisma = createPrisma(url);
  try {
    const orders = await prisma.order.findMany({ orderBy: { createdAt: 'desc' } });
    const config = await prisma.config.findFirst({ where: { id: 1 } });
    
    // 今日の売上 (簡易集計)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todaySales = orders
      .filter(o => o.status === 'completed' && new Date(o.createdAt) >= today)
      .reduce((sum, o) => sum + (o.totalPrice || 0), 0);

    return c.json({
      orders,
      isShopOpen: (config as any)?.isShopOpen ?? true,
      todaySales,
      pendingCount: orders.filter(o => o.status === 'pending').length
    });
  } catch (e: any) {
    console.error("DB_ERROR:", e.message);
    return c.json({ error: "DB接続エラー: " + e.message }, 500);
  } finally {
    await prisma.$disconnect();
  }
})

// 3. 受付停止切り替え
app.post('/admin/toggle-shop', async (c) => {
  const prisma = createPrisma(c.env.DATABASE_URL);
  try {
    const { open } = await c.req.json();
    await (prisma.config as any).upsert({
      where: { id: 1 },
      update: { isShopOpen: open },
      create: { id: 1, isShopOpen: open }
    });
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  } finally {
    await prisma.$disconnect();
  }
})

// 4. 個人情報抹消
app.post('/admin/scrub', async (c) => {
  const prisma = createPrisma(c.env.DATABASE_URL);
  try {
    const { id } = await c.req.json();
    await prisma.order.update({
      where: { id: Number(id) },
      data: { transferCode: "SCRUBBED", authPassword: "HIDDEN" }
    });
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  } finally {
    await prisma.$disconnect();
  }
})

export default app
