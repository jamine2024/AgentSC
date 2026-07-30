import winSystem from './builtin-rules/windows-system.json'
import browsers from './builtin-rules/browsers.json'
import devCache from './builtin-rules/dev-cache.json'
import { insertBuiltinRule, countBuiltinRulesByKey, type CleanerRule } from './db'

interface BuiltinRuleDef {
  id: string
  name: string
  type: CleanerRule['type']
  target?: string
  patterns?: string
  schedule: string
  enabled?: boolean
}

interface BuiltinFeed {
  name: string
  description: string
  version: string
  homepage: string
  rules: BuiltinRuleDef[]
}

const BUILTIN_SOURCES: { key: string; feed: BuiltinFeed }[] = [
  { key: 'windows-system', feed: winSystem as unknown as BuiltinFeed },
  { key: 'browsers', feed: browsers as unknown as BuiltinFeed },
  { key: 'dev-cache', feed: devCache as unknown as BuiltinFeed },
]

/**
 * 启动时把内置规则一次性写入 cleaner_rules。
 * 用 external_id 前缀 `builtin::<key>::<id>` 做幂等：某个 key 已播种过则跳过，
 * 不会重复写入，也已删除的内置规则不会被复活。
 */
export function seedBuiltinRules() {
  for (const src of BUILTIN_SOURCES) {
    const prefix = `builtin::${src.key}::`
    if (countBuiltinRulesByKey(prefix) > 0) continue
    for (const r of src.feed.rules) {
      insertBuiltinRule({
        name: r.name,
        type: r.type,
        target: r.target || '',
        patterns: r.patterns || null,
        schedule: r.schedule,
        enabled: r.enabled === false ? 0 : 1,
        external_id: `${prefix}${r.id}`,
      })
    }
  }
}
