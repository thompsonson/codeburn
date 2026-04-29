import { readFile, writeFile, mkdir, rename } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'

export type PlanId = 'claude-pro' | 'claude-max' | 'claude-max-5x' | 'cursor-pro' | 'custom' | 'none'
export type PlanProvider = 'claude' | 'codex' | 'cursor' | 'all'

export type Plan = {
  id: PlanId
  monthlyUsd: number
  provider: PlanProvider
  resetDay?: number
  setAt: string
}

export type CodeburnConfig = {
  currency?: {
    code: string
    symbol?: string
  }
  plan?: Plan
  modelAliases?: Record<string, string>
  branchLabels?: Record<string, string>
}

const DEFAULT_BRANCH_LABELS: Record<string, string> = {
  'ci/': 'CI',
  'docs/adr': 'ADR',
  'feat/': 'Feature',
  'feature/': 'Feature',
  'fix/': 'Fix',
  'bugfix/': 'Fix',
  'docs/': 'Docs',
  'test/': 'Tests',
  'tests/': 'Tests',
  'refactor/': 'Refactor',
  'chore/': 'Chore',
  'release/': 'Release',
}

export function resolveBranchLabels(config?: CodeburnConfig): Record<string, string> {
  return config?.branchLabels ?? DEFAULT_BRANCH_LABELS
}

// Longest-pattern wins so `docs/adr` beats `docs/`. Returns undefined when
// nothing matches; callers decide whether to fall back to "Other".
export function getBranchLabel(branch: string | undefined, labels: Record<string, string>): string | undefined {
  if (!branch) return undefined
  const sorted = Object.keys(labels).sort((a, b) => b.length - a.length)
  for (const pattern of sorted) {
    if (branch.startsWith(pattern) || branch === pattern.replace(/\/$/, '')) {
      return labels[pattern]
    }
  }
  return undefined
}

function getConfigDir(): string {
  return join(homedir(), '.config', 'codeburn')
}

function getConfigPath(): string {
  return join(getConfigDir(), 'config.json')
}

export async function readConfig(): Promise<CodeburnConfig> {
  try {
    const raw = await readFile(getConfigPath(), 'utf-8')
    return JSON.parse(raw) as CodeburnConfig
  } catch {
    return {}
  }
}

export async function saveConfig(config: CodeburnConfig): Promise<void> {
  await mkdir(getConfigDir(), { recursive: true })
  const configPath = getConfigPath()
  const tmpPath = `${configPath}.tmp`
  await writeFile(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
  await rename(tmpPath, configPath)
}

export async function readPlan(): Promise<Plan | undefined> {
  const config = await readConfig()
  return config.plan
}

export async function savePlan(plan: Plan): Promise<void> {
  const config = await readConfig()
  config.plan = plan
  await saveConfig(config)
}

export async function clearPlan(): Promise<void> {
  const config = await readConfig()
  delete config.plan
  await saveConfig(config)
}

export function getConfigFilePath(): string {
  return getConfigPath()
}
