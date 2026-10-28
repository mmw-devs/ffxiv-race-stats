/**
 * 站点章节结构。
 *
 * - id / 顺序 / 导航标签属于站点结构，留在代码；
 * - 章节的 kicker / title 属于运营文案，来自 data.json 的 content.sections；
 * - NavBar 与 App 都从这里取 id / 顺序，避免两处各写一份锚点。
 */
export const SECTIONS = [
  { id: 'ranking', navLabel: '实时排名', index: '01', page: 'P.01' },
  { id: 'news', navLabel: '速报', index: '02', page: 'P.02' },
  { id: 'sponsors', navLabel: '赞助', index: '03', page: 'P.03' },
  { id: 'guides', navLabel: '攻略', index: '04', page: 'P.04' },
] as const

export type SectionId = (typeof SECTIONS)[number]['id']

export function getSection(id: SectionId): (typeof SECTIONS)[number] {
  const section = SECTIONS.find((item) => item.id === id)
  if (!section) throw new Error(`未知章节: ${id}`)
  return section
}
