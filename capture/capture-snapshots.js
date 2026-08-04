/**
 * 全站静态快照流水线(给 Claude Design 做设计参考)
 *
 * 做法:登录 dev 站(5174,API 代理本机 live)→ 逐页渲染 → 序列化为自包含 HTML:
 *   - canvas(echarts/WebGL)→ 替换为 <img data:URI>(WebGL 拿不到就留占位)
 *   - iframe(opencode)→ 标注占位块
 *   - 同源 <img>/<link rel=stylesheet> → 内联 data:URI / <style>
 *   - 去 <script>,快照是纯静态参考稿
 *
 * 脱敏(Codex 审后设计):
 *   1. 主防线在 API 响应层——拦截全部 /api 响应,先把真实姓名/邮箱/手机号替换成
 *      化名再交给页面渲染 ⇒ 图表 canvas 位图、整页 PNG 截图里也天然是化名;
 *   2. 序列化后的 HTML 再跑一遍字符串替换,双保险;
 *   3. 用户名单拉取 fail-closed:拉不到就中止,绝不静默放行真名。
 *
 * 输出:site/pages/<slug>.html + site/shots/<slug>.png + site/index.html
 * 重跑:SNAP_PASS=*** node capture-snapshots.js   (可 SNAP_ONLY=slug 只跑单页)
 */
const { chromium } = require('playwright-core')
const fs = require('fs')
const path = require('path')

const BASE = process.env.SNAP_BASE || 'http://127.0.0.1:5174'
const USER = process.env.SNAP_USER || 'admin'
const PASS = process.env.SNAP_PASS
if (!PASS) {
  console.error('缺少 SNAP_PASS 环境变量(不提供默认密码,避免凭据进仓库)')
  process.exit(1)
}
const OUT = process.env.SNAP_OUT || path.resolve(__dirname, '..', 'site')

const PAGES = [
  { slug: 'workbench', path: '/workbench', title: '工作台(首页)' },
  { slug: 'overview', path: '/overview', title: '平台概览' },
  { slug: 'chat', path: '/chat', title: 'AI研发助手' },
  { slug: 'porosity', path: '/porosity', title: '孔隙率分析' },
  { slug: 'spheresity', path: '/spheresity', title: '球形度分析' },
  { slug: 'primaryparticle', path: '/primaryparticle', title: '一次粒子分析' },
  { slug: 'crackparticle', path: '/crackparticle', title: '开裂颗粒分析' },
  { slug: 'singlecrystal', path: '/singlecrystalparticle', title: '单晶颗粒分析' },
  { slug: 'cellpose', path: '/particlelengthcellpose', title: 'Cellpose粒径分析' },
  { slug: 'batteryparticle', path: '/batteryparticle', title: '电池颗粒分析' },
  { slug: 'tools-center', path: '/tools/center', title: '工具中心' },
  { slug: 'tools-history', path: '/tools/history', title: '工具运行历史' },
  { slug: 'tools-runner', path: '/tools/runner', title: '工具运行' },
  { slug: 'tools-logs', path: '/tools/logs', title: '工具运行日志' },
  { slug: 'tools-workshop', path: '/tools/workshop', title: '工具工坊' },
  { slug: 'skills-workshop', path: '/skills/workshop', title: '技能工坊' },
  { slug: 'skills-mine', path: '/skills/mine', title: '我的Skill' },
  { slug: 'skills-review', path: '/skills/review', title: '待审核技能' },
  { slug: 'skills-curator', path: '/skills/curator', title: '知识库维护' },
  { slug: 'lims-import', path: '/lims/lims-import', title: 'LIMS 数据导入' },
  { slug: 'ai-usage', path: '/ai-usage/ai-usage-stats', title: 'AI 使用统计' },
  { slug: 'feedback', path: '/feedback/feedback-board', title: '问题反馈' },
  { slug: 'literature', path: '/literature/parse', title: '文献解析' },
  { slug: 'my-kb', path: '/literature/my-kb-library', title: '我的知识库' },
  { slug: 'kb-library', path: '/kb-library/manage', title: '文献知识库' },
  { slug: 'experience', path: '/experience-center/library', title: '经验库' },
  { slug: 'lineage-tree', path: '/lineage/tree', title: '数据图谱·关联树' },
  { slug: 'factor', path: '/lineage/factor', title: '数据图谱·因子分析' },
  { slug: 'data-entry-form', path: '/data_entry/experiment_form', title: '实验单填写' },
  { slug: 'other-sync', path: '/data_entry/other_sync', title: '其他系统入库' },
  // ── 交互态(图像分析页三步流的后两步,带真实任务/真实结果) ──────────
  { slug: 'porosity-progress', path: '/porosity', title: '孔隙率分析·进度查看', interact: 'progress' },
  // 七个分析方法:基础页=上传态(两栏定稿),以下为各自的详细结果(真实已完成任务)
  { slug: 'porosity-result', path: '/porosity', title: '孔隙率分析·详细结果(真实结果)', interact: 'result' },
  { slug: 'spheresity-result', path: '/spheresity', title: '球形度分析·详细结果(真实结果)', interact: 'result' },
  { slug: 'primaryparticle-result', path: '/primaryparticle', title: '一次粒子分析·详细结果(真实结果)', interact: 'result' },
  { slug: 'crackparticle-result', path: '/crackparticle', title: '开裂颗粒分析·详细结果(真实结果)', interact: 'result' },
  { slug: 'singlecrystal-result', path: '/singlecrystalparticle', title: '单晶颗粒分析·详细结果(真实结果)', interact: 'result' },
  { slug: 'cellpose-result', path: '/particlelengthcellpose', title: 'Cellpose粒径分析·详细结果(真实结果)', interact: 'result' },
  { slug: 'battery-result', path: '/batteryparticle', title: '电池颗粒分析·详细结果(真实结果)', interact: 'result' },
  // 文献:上传态=literature 基础页;结果态=真实解析文献查看器(供文献页改造参考)
  { slug: 'literature-result', path: '/literature/parse', title: '文献解析·结果查看(真实文献)', steps: [{ step: '进度', wait: 2500 }, { button: '查看', wait: 8000 }] },
  // ── 二级 UI(按钮后面的弹窗/抽屉),steps 顺序执行:button=点按钮文案,
  //    tab=切 n-tabs,option=点下拉项,css=点选择器,fill=填输入框(fillCss 定位) ──
  { slug: 'chat-workspace-files', path: '/chat', title: 'AI研发助手·工作区文件弹窗', steps: [{ button: '工作区文件', wait: 3000 }] },
  { slug: 'chat-ai-tasks', path: '/chat', title: 'AI研发助手·定时任务弹窗', steps: [{ button: '更多' }, { option: '定时任务', wait: 2500 }] },
  { slug: 'chat-scenarios', path: '/chat', title: 'AI研发助手·场景灵感抽屉', steps: [{ button: '更多' }, { option: '场景灵感', wait: 1500 }] },
  { slug: 'chat-kb-scope', path: '/chat', title: 'AI研发助手·知识库范围弹窗', steps: [{ button: '知识库范围', wait: 2500 }] },
  { slug: 'tools-wizard', path: '/tools/workshop', title: '工具工坊·新建工具向导', steps: [{ button: '新建工具', wait: 1500 }] },
  { slug: 'skills-detail', path: '/skills/workshop', title: '技能工坊·技能详情弹窗', steps: [{ button: '查看', wait: 2500 }] },
  { slug: 'experience-detail', path: '/experience-center/library', title: '经验库·经验详情弹窗', steps: [{ css: '.entry-card', wait: 2500 }] },
  { slug: 'feedback-new', path: '/feedback/feedback-board', title: '问题反馈·提交反馈弹窗', steps: [{ button: '提反馈', wait: 1500 }] },
  { slug: 'literature-progress', path: '/literature/parse', title: '文献解析·进度列表', steps: [{ step: '进度', wait: 3000 }] },
  { slug: 'lineage-dossier', path: '/lineage/tree', title: '关联树·批次档案(四域钻取,真实数据)', steps: [{ fill: 'CAM', fillCss: '.gx-search input' }, { button: '定位', wait: 3000 }, { css: '.gx-result-batch', wait: 7000 }] },
]

async function runSteps(page, steps) {
  for (const s of steps) {
    if (s.fill != null) await page.locator(s.fillCss || 'input').first().fill(s.fill)
    else if (s.tab) await page.locator('.n-tabs-tab', { hasText: s.tab }).first().click()
    else if (s.step) await page.locator('.step-bar .step', { hasText: s.step }).first().click()
    else if (s.button)
      await page.locator('button:not([disabled])', { hasText: s.button }).first().click()
    else if (s.option) await page.locator('.n-dropdown-option', { hasText: s.option }).first().click()
    else if (s.css) await page.locator(s.css).first().click()
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
    await page.waitForTimeout(s.wait || 1200)
  }
}

// ── 交互态:进入「进度查看」/「详细结果」再快照 ──────────────────────────
// progress = 切到进度 tab(真实任务表);result = 进度 tab 点第一条已完成任务的
// 「打开」进入详细结果(真实图表/统计)。三种结果组件(通用/Cellpose/电池)各抓一份。
async function runInteraction(page, kind) {
  // 图像分析页 2026-08-04 起为步骤条(.step-bar);先关自动弹出的操作说明抽屉
  await page.locator('.n-drawer .n-base-close').first().click({ timeout: 3000 }).catch(() => {})
  await page.waitForTimeout(300)
  await page.locator('.step-bar .step', { hasText: '进度查看' }).first().click()
  await page.waitForSelector('.n-data-table tbody tr', { timeout: 20000 })
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(1500)
  if (kind === 'result') {
    await page.locator('button:not([disabled])', { hasText: '打开' }).first().click()
    // 结果组件拉图片/画图表,多等一会
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {})
    await page.waitForTimeout(5000)
  }
}

// ── 序列化:在页面上下文里把当前 DOM 变成自包含 HTML ────────────────────
async function serializePage(page) {
  return page.evaluate(async () => {
    // 1) 先在真实 DOM 上采集 canvas 位图与 img 的 dataURI(clone 会丢)
    const canvasData = [...document.querySelectorAll('canvas')].map((c) => {
      try {
        return { w: c.clientWidth, h: c.clientHeight, uri: c.toDataURL('image/png') }
      } catch {
        return { w: c.clientWidth, h: c.clientHeight, uri: null }
      }
    })
    async function toDataUri(url) {
      try {
        const r = await fetch(url)
        if (!r.ok) return null
        const b = await r.blob()
        if (b.size > 2 * 1024 * 1024) return null // 超 2MB 的资源不内联
        return await new Promise((res) => {
          const fr = new FileReader()
          fr.onload = () => res(fr.result)
          fr.onerror = () => res(null)
          fr.readAsDataURL(b)
        })
      } catch {
        return null
      }
    }
    const imgMap = new Map()
    for (const img of document.querySelectorAll('img[src]')) {
      const src = img.getAttribute('src')
      if (!src || src.startsWith('data:')) continue
      if (!imgMap.has(src)) imgMap.set(src, await toDataUri(src))
    }
    const cssTexts = []
    for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
      try {
        const r = await fetch(link.href)
        cssTexts.push(r.ok ? await r.text() : '')
      } catch {
        cssTexts.push('')
      }
    }

    // 2) clone 并改写(clone 在 canvas 采集之后做,顺序与原 DOM 一致)
    const clone = document.documentElement.cloneNode(true)
    clone.querySelectorAll('script, link[rel="modulepreload"]').forEach((n) => n.remove())
    clone.querySelectorAll('canvas').forEach((c, i) => {
      const d = canvasData[i]
      const rep = document.createElement(d && d.uri ? 'img' : 'div')
      if (d && d.uri) {
        rep.src = d.uri
        rep.width = d.w
        rep.height = d.h
      } else {
        rep.style.cssText = `width:${d?.w || 300}px;height:${d?.h || 150}px;display:flex;align-items:center;justify-content:center;background:#f1f3f5;color:#868e96;font-size:12px;border-radius:8px`
        rep.textContent = '〔WebGL 画布:静态快照无法导出,见同名 .png 截图〕'
      }
      c.replaceWith(rep)
    })
    clone.querySelectorAll('iframe').forEach((f) => {
      const rep = document.createElement('div')
      rep.style.cssText =
        'flex:1;min-height:480px;display:flex;align-items:center;justify-content:center;background:#fafbfc;border:1px dashed #dee2e6;color:#868e96;font-size:13px'
      rep.textContent =
        '〔OpenCode 对话区(iframe 嵌入的第三方 UI):会话列表+消息流+输入框在此区域内,不属于本平台前端代码,重新设计时视为固定内容区即可〕'
      f.replaceWith(rep)
    })
    clone.querySelectorAll('img[src]').forEach((img) => {
      const uri = imgMap.get(img.getAttribute('src'))
      if (uri) img.setAttribute('src', uri)
    })
    clone.querySelectorAll('link[rel="stylesheet"]').forEach((l, i) => {
      const st = document.createElement('style')
      st.textContent = cssTexts[i] || ''
      l.replaceWith(st)
    })
    return '<!DOCTYPE html>\n' + clone.outerHTML
  })
}

// ── 脱敏 ────────────────────────────────────────────────────────────────
const EMAIL_RE = /[\w.+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/g
const PHONE_RE = /1[3-9]\d{9}/g

function buildScrubber(users) {
  const map = []
  let i = 0
  for (const u of users) {
    for (const field of ['username', 'alias', 'nickname']) {
      const v = u[field]
      if (v && v.length >= 3 && v !== 'admin') {
        i += 1
        map.push([v, `研发员${String(i).padStart(2, '0')}`])
      }
    }
  }
  // 长名优先替换,避免子串串扰
  map.sort((a, b) => b[0].length - a[0].length)
  return (text) => {
    for (const [from, to] of map) text = text.split(from).join(to)
    return text.replace(EMAIL_RE, 'user@example.com').replace(PHONE_RE, '138****0000')
  }
}

;(async () => {
  fs.mkdirSync(path.join(OUT, 'pages'), { recursive: true })
  fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true })
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
  })

  // ── 登录页快照:独立无登录态 context,避免带 session 抓成跳转页 ──
  {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      ignoreHTTPSErrors: true,
    })
    const p = await ctx.newPage()
    await p.goto(BASE + '/login', { waitUntil: 'networkidle' })
    await p.waitForTimeout(1500)
    await p.screenshot({ path: path.join(OUT, 'shots', 'login.png'), fullPage: true })
    fs.writeFileSync(path.join(OUT, 'pages', 'login.html'), await serializePage(p))
    console.log('✓ login(未登录独立 context)')
    await ctx.close()
  }

  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true, // 本机 live(https://localhost)为自签证书
  })

  // 登录
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' })
  const inputs = page.locator('input')
  await inputs.nth(0).fill(USER)
  await inputs.nth(1).fill(PASS)
  await page.keyboard.press('Enter')
  await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 15000 })
  await page.waitForLoadState('networkidle').catch(() => {})

  // ── 拉真实用户名单做脱敏映射(fail-closed:拉不到就中止) ──────────────
  const users = await page.evaluate(async () => {
    let token = ''
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k.toLowerCase().includes('access_token')) {
        try {
          const v = JSON.parse(localStorage.getItem(k))
          token = v?.value ?? v
        } catch {
          token = localStorage.getItem(k)
        }
      }
    }
    const r = await fetch('/api/v1/user/list?page=1&page_size=1000', { headers: { token } })
    if (!r.ok) throw new Error('user/list HTTP ' + r.status)
    const j = await r.json()
    if (!Array.isArray(j.data) || j.data.length === 0)
      throw new Error('user/list 返回空,拒绝在无脱敏名单下继续')
    if (j.total && j.total > j.data.length)
      throw new Error(`user/list 未取全(${j.data.length}/${j.total})`)
    return j.data.map((u) => ({ username: u.username, alias: u.alias, nickname: u.nickname }))
  })
  const scrub = buildScrubber(users)
  console.log(`脱敏名单: ${users.length} 个用户`)

  // ── 主防线:API 响应层脱敏——页面(含图表 canvas/截图)渲染的就是化名 ──
  await page.route('**/api/**', async (route) => {
    const resp = await route.fetch()
    const ct = resp.headers()['content-type'] || ''
    if (ct.includes('json') || ct.includes('text')) {
      const body = await resp.text()
      await route.fulfill({ response: resp, body: scrub(body) })
    } else {
      await route.fulfill({ response: resp })
    }
  })

  const only = process.env.SNAP_ONLY
  const results = []
  for (const p of PAGES) {
    if (only && p.slug !== only) continue
    try {
      await page.goto(BASE + p.path, { waitUntil: 'domcontentloaded' })
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
      await page.waitForTimeout(3500) // 图表/异步接口
      // 关掉「首次进入自动展开」的操作说明抽屉:快照浏览器每轮都是新 profile,
      // 每页都会触发自动展开,把右侧内容盖住 → Claude Design 误读为"右栏没删"
      // 用 Esc 关(点 X 会在抽屉收起后穿透点到下层元素,曾误开头像菜单)
      if (await page.locator('.n-drawer:visible').count().catch(() => 0)) {
        await page.keyboard.press('Escape')
        await page.waitForTimeout(400)
      }
      if (p.interact) await runInteraction(page, p.interact)
      if (p.steps) await runSteps(page, p.steps)
      // 触发懒加载再回顶
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      await page.waitForTimeout(600)
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.waitForTimeout(400)

      await page.screenshot({ path: path.join(OUT, 'shots', `${p.slug}.png`), fullPage: true })
      let html = await serializePage(page)
      html = scrub(html) // 双保险:序列化文本再过一遍
      fs.writeFileSync(path.join(OUT, 'pages', `${p.slug}.html`), html)
      const kb = Math.round(html.length / 1024)
      console.log(`✓ ${p.slug.padEnd(18)} ${String(kb).padStart(6)} KB  ${p.title}`)
      results.push({ ...p, kb })
    } catch (e) {
      console.log(`✗ ${p.slug}: ${e.message.split('\n')[0]}`)
      results.push({ ...p, error: e.message.split('\n')[0] })
    }
  }

  // 索引页(SNAP_ONLY 单页补抓时不重写,避免把完整索引冲掉)
  if (only) {
    await browser.close()
    console.log('\n单页补抓完成(索引未动)→ ' + OUT)
    return
  }
  const rows = results
    .map((r) =>
      r.error
        ? `<li>${r.title} — <em>抓取失败: ${r.error}</em></li>`
        : `<li><a href="pages/${r.slug}.html">${r.title}</a> <small>(${r.kb} KB · <a href="shots/${r.slug}.png">截图</a>)</small></li>`
    )
    .join('\n')
  fs.writeFileSync(
    path.join(OUT, 'index.html'),
    `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>研发智能平台 · 页面快照索引</title>
<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:40px auto;line-height:1.8}small{color:#868e96}</style></head>
<body><h1>研发智能平台 · 全站页面静态快照</h1>
<p>技术栈 Vue3 + naive-ui,设计基准宽 1440。快照为渲染后 DOM 的自包含 HTML(样式内联、canvas 转位图、脚本已剥离),
仅作设计参考,不可交互;每页附整页 PNG 截图。脱敏:API 响应层替换真实姓名/邮箱/手机号后再渲染。</p>
<ul><li><a href="pages/login.html">登录页</a> <small>(<a href="shots/login.png">截图</a>)</small></li>
${rows}</ul></body></html>`
  )
  await browser.close()
  console.log('\n完成 → ' + OUT)
})().catch((e) => {
  console.error('FAIL:', e)
  process.exit(1)
})
