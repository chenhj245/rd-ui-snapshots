# 研发智能平台 · 全站页面静态快照

内部研发智能平台(Vue3 + naive-ui + FastAPI)全部页面的**渲染后静态快照**,
专供 AI 设计工具(Claude Design 等)读取、评价与出重构稿使用。

## 内容

| 路径 | 说明 |
|---|---|
| `site/index.html` | 索引页,链到全部 31 个页面 |
| `site/pages/*.html` | 每页一个自包含 HTML:登录后真实渲染的 DOM,样式已内联、canvas 图表转位图、脚本已剥离。**不可交互**,纯视觉参考 |
| `site/shots/*.png` | 每页整页截图(与 HTML 同名),快速浏览用 |
| `capture/capture-snapshots.js` | 快照流水线脚本,可重跑(`node capture-snapshots.js`,需 playwright-core + Chrome) |

## 给设计工具的说明

- 技术栈:Vue 3 + naive-ui(组件库),设计基准宽 **1440**,主题色蓝 `#2563EB`。
- 语义令牌层已存在(`--text-primary / --border-light / --radius-md / --ease-out-strong` 等),
  重构稿请给**可映射到 token 的数值**,不必迁就快照里的散值。
- `AI研发助手` 页中部对话区是 iframe 嵌入的第三方 UI(OpenCode),快照中为标注占位块,
  重新设计时视为固定内容区。
- 关联树页的 3D 星图为 WebGL,HTML 快照中是占位块,观感见同名 PNG。

## 脱敏

主防线在 **API 响应层**:抓取时拦截全部接口响应,先把真实姓名→`研发员NN`、
邮箱→`user@example.com`、手机号→`138****0000` 再交给页面渲染,因此图表位图与
整页截图里同样是化名;序列化后的 HTML 另跑一遍字符串替换作双保险,用户名单
拉取失败即中止(fail-closed)。业务数据(批次号、检测数值等)为内部演示数据。

## 重新生成

```bash
cd capture && npm install
SNAP_BASE=http://127.0.0.1:5174 SNAP_PASS=*** node capture-snapshots.js
# 单页重抓:SNAP_ONLY=<slug> node capture-snapshots.js
```
