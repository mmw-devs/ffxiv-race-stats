// 数据文件路径的唯一来源。
//
// 前端、Astro 配置、构建脚本都从这里取；不要在各自文件里硬编码。
// 真源 URL（ops 仓库）在 scripts/data-source.mjs，这里是「运行路径 / 构建产物路径」。
//
// 跨仓库契约：ops 生产站构建必须把 public/data.json 复制到 DATA_DIST_PATH，
// 并让部署产物以 DATA_PUBLIC_PATH 提供；改路径时两个仓库要同时改。
export const DATA_PUBLIC_PATH = '/data.json'
export const DATA_DIST_PATH = 'dist/data.json'

// 构建期 SEO 快照；只在 build:preview / build-dist 使用，不提交。
export const DATA_BUILD_DIR = '.astro-data'
export const DATA_BUILD_DATA_PATH = `${DATA_BUILD_DIR}/data.json`
export const DATA_BUILD_META_PATH = `${DATA_BUILD_DIR}/meta.json`
