// data.json 运行时形状校验（防御性，A3）。
//
// data.json 在 ops 仓库已过 Ajv + schema 三阶段严格校验，正常不会错；
// 这里只做「渲染直接读取、缺失会崩」的字段形状轻量检查，形状异常时让
// App.vue 走 error 态（带重试按钮），而不是静默错渲染。
// 值域校验（phase/region/bossHP 白名单等）仍是 ops CI 的职责，此处不重复。

export interface ValidationResult {
  ok: boolean
  errors: string[]
}

const isStr = (v: unknown): v is string => typeof v === 'string'
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isBool = (v: unknown): v is boolean => typeof v === 'boolean'
const isArr = (v: unknown): v is unknown[] => Array.isArray(v)
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function checkStr(obj: Record<string, unknown>, key: string, path: string, errors: string[]): void {
  if (!isStr(obj[key])) errors.push(`${path}.${key} 应为 string`)
}

export function validateRaceData(data: unknown): ValidationResult {
  const errors: string[] = []
  if (!isObj(data)) {
    return { ok: false, errors: ['data 应为对象'] }
  }

  // meta
  if (!isObj(data.meta)) {
    errors.push('meta 应为对象')
  } else {
    checkStr(data.meta, 'eventName', 'meta', errors)
    checkStr(data.meta, 'status', 'meta', errors)
    if (data.meta.startTime !== undefined && !isStr(data.meta.startTime)) {
      errors.push('meta.startTime 应为 string')
    }
  }

  // teams
  if (!isArr(data.teams)) {
    errors.push('teams 应为数组')
  } else {
    data.teams.forEach((t, i) => {
      const p = `teams[${i}]`
      if (!isObj(t)) { errors.push(`${p} 应为对象`); return }
      checkStr(t, 'id', p, errors)
      if (!isNum(t.rank)) errors.push(`${p}.rank 应为 number`)
      if (!isNum(t.bossHP)) errors.push(`${p}.bossHP 应为 number`)
      checkStr(t, 'phase', p, errors)
      checkStr(t, 'region', p, errors)
      if (!isArr(t.players) || t.players.length !== 8) {
        errors.push(`${p}.players 应为恰好 8 项的数组`)
      } else {
        t.players.forEach((pl, j) => {
          const q = `${p}.players[${j}]`
          if (!isObj(pl)) { errors.push(`${q} 应为对象`); return }
          checkStr(pl, 'job', q, errors)
          checkStr(pl, 'role', q, errors)
          checkStr(pl, 'stream', q, errors)
          if (!isBool(pl.streaming)) errors.push(`${q}.streaming 应为 boolean`)
        })
      }
    })
  }

  // news
  if (!isArr(data.news)) {
    errors.push('news 应为数组')
  } else {
    data.news.forEach((n, i) => {
      const p = `news[${i}]`
      if (!isObj(n)) { errors.push(`${p} 应为对象`); return }
      checkStr(n, 'id', p, errors)
      checkStr(n, 'time', p, errors)
      checkStr(n, 'text', p, errors)
      if (!isBool(n.urgent)) errors.push(`${p}.urgent 应为 boolean`)
    })
  }

  // broadcasters
  if (!isArr(data.broadcasters)) {
    errors.push('broadcasters 应为数组')
  } else {
    data.broadcasters.forEach((b, i) => {
      const p = `broadcasters[${i}]`
      if (!isObj(b)) { errors.push(`${p} 应为对象`); return }
      checkStr(b, 'id', p, errors)
      checkStr(b, 'name', p, errors)
      checkStr(b, 'platform', p, errors)
      checkStr(b, 'url', p, errors)
      checkStr(b, 'note', p, errors)
    })
  }

  // notices / sponsors（schema 里是 unknown[]，前端约定为 string[] 与 {name,desc}[]）
  if (!isArr(data.notices)) {
    errors.push('notices 应为数组')
  } else {
    data.notices.forEach((n, i) => {
      if (!isStr(n)) errors.push(`notices[${i}] 应为 string`)
    })
  }
  if (!isArr(data.sponsors)) {
    errors.push('sponsors 应为数组')
  } else {
    data.sponsors.forEach((s, i) => {
      if (!isObj(s)) { errors.push(`sponsors[${i}] 应为对象`); return }
      checkStr(s, 'name', `sponsors[${i}]`, errors)
      checkStr(s, 'desc', `sponsors[${i}]`, errors)
    })
  }

  return { ok: errors.length === 0, errors }
}
