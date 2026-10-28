// 数据文件路径的唯一来源。
//
// 前端、Astro 配置、构建脚本都从这里取；不要在各自文件里硬编码。
// 真源 URL（ops 仓库）在 scripts/data-source.mjs，这里是「运行路径 / 构建产物路径」。
export const DATA_PUBLIC_PATH = '/data.json'
export const DATA_DIST_PATH = 'dist/data.json'
