// data.json 的单一事实源（SSOT）配置——所有需要数据的脚本/代理都从这里取，不要各自硬编码。
//
// 原则：
//   data.json 只有一份，位于 ops 仓库 mmw-devs/ffxiv-race-ops 的 public/data.json，
//   由运营人员通过 content/* PR 维护。dev 仓库不保存副本；需要数据的构建在运行时读取真源。
//
// 为什么读 raw.githubusercontent 而不是生产站：
//   生产站（CF Pages）是这份文件的「部署产物」——CDN、缓存、构建时序都会参与其中。
//   把部署产物当源，等于让部署状态参与数据定义；读仓库里的文件才是读真源本身。
//
// 覆盖方式（本地调试/演练）：
//   DATA_SOURCE_URL   指向其它 data.json（如 http://127.0.0.1:8899/data.json）
//   PROD_SITE_ORIGIN  预览站反代的目标站点

export const OPS_REPO = 'mmw-devs/ffxiv-race-ops'
export const OPS_BRANCH = 'main'

/** 真源 URL（绝对地址） */
export const DATA_SOURCE_URL = (
  process.env.DATA_SOURCE_URL?.trim() ||
  `https://raw.githubusercontent.com/${OPS_REPO}/${OPS_BRANCH}/public/data.json`
).trim()

/** 生产站 origin（预览站把 /data.json 反代到这里） */
export const PROD_SITE_ORIGIN = (
  process.env.PROD_SITE_ORIGIN?.trim() || 'https://ffxiv-race-stats.pages.dev'
).replace(/\/+$/, '')

/** 把绝对 URL 拆成 { origin, path }（Vite 代理需要分开配置） */
export function splitUrl(url) {
  const u = new URL(url)
  return { origin: u.origin, path: u.pathname + u.search }
}
