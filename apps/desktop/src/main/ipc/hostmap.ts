import { app, ipcMain } from 'electron'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  IPC,
  type HostMapBrowserDto,
  type HostMapCurlDto,
  type HostMapGroupDto,
  type HostMapGroupInput,
  type HostMapOpenDto,
  type HostMapStateDto,
  type HostMapTargetDto
} from '@infra/shared'
import {
  buildChromiumArgs,
  buildCurlResolveCommand,
  buildHostResolverRules,
  defaultUrlFor,
  detectChromiumBrowsers,
  isSafeHostPattern,
  isSafeHttpUrl,
  isSafeIpLiteral
} from '@infra/core'

/**
 * HostMap — "đổi IP của domain" để test 1 server trong cụm load balance, KHÔNG sửa file hosts
 * và KHÔNG cần quyền admin. Cơ chế + lý do chọn nó: xem `packages/core/src/hostmap/hostMap.ts`.
 *
 * Lưu cấu hình ở `hostmap.json` trong userData (pattern của monitor-settings.json), CHỦ Ý không
 * để trong vault: dữ liệu ở đây không có bí mật nào (chỉ domain + IP nội bộ), mà vault thì tự
 * khoá sau 15 phút idle — bắt user mở khoá chỉ để đổi IP test là phiền vô cớ. Đánh đổi: chưa
 * theo sync E2EE (muốn có thì phải thêm bảng vào vault + luật merge).
 */

const MAX_GROUPS = 100
const MAX_PATTERNS = 200
const MAX_TARGETS = 50
const NAME_MAX = 80

interface HostMapFile {
  groups: HostMapGroupDto[]
}

function statePath(): string {
  return join(app.getPath('userData'), 'hostmap.json')
}

/** Thư mục chứa profile browser app sinh ra (1 profile/target — xem buildChromiumArgs). */
function profilesRoot(): string {
  return join(app.getPath('userData'), 'hostmap-profiles')
}

async function exists(p: string): Promise<boolean> {
  return access(p).then(
    () => true,
    () => false
  )
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s.length > 0 && s.length <= max ? s : null
}

/** Lọc target rác từ file/IPC: IP phải là IP thật, nhãn không rỗng. */
function saneTargets(raw: unknown): HostMapTargetDto[] {
  if (!Array.isArray(raw)) return []
  const out: HostMapTargetDto[] = []
  for (const item of raw.slice(0, MAX_TARGETS)) {
    const t = item as Partial<HostMapTargetDto>
    const ip = str(t.ip, 60)
    const label = str(t.label, NAME_MAX)
    if (ip === null || !isSafeIpLiteral(ip)) continue
    out.push({ id: str(t.id, 60) ?? randomUUID(), label: label ?? ip, ip })
  }
  return out
}

/**
 * Chuẩn hoá 1 group. Validate Ở ĐÂY (không chỉ ở UI): pattern rác lọt xuống `buildHostResolverRules`
 * là throw, mà đường IPC thì renderer nào cũng gọi được — và pattern là bề mặt injection của
 * tính năng này (xem ghi chú an ninh trong hostMap.ts).
 */
function saneGroup(raw: unknown): HostMapGroupDto | null {
  const g = (raw ?? {}) as Partial<HostMapGroupDto>
  const name = str(g.name, NAME_MAX)
  if (name === null) return null
  const patterns = Array.isArray(g.patterns)
    ? [...new Set(g.patterns.filter((p): p is string => typeof p === 'string').map((p) => p.trim()))]
        .filter((p) => isSafeHostPattern(p))
        .slice(0, MAX_PATTERNS)
    : []
  const targets = saneTargets(g.targets)
  const activeId = str(g.activeTargetId, 60)
  const url = str(g.url, 2000)
  return {
    id: str(g.id, 60) ?? randomUUID(),
    name,
    patterns,
    targets,
    // Target đã bị xoá thì coi như chưa chọn (không giữ id treo)
    activeTargetId: targets.some((t) => t.id === activeId) ? activeId : (targets[0]?.id ?? null),
    url: url !== null && isSafeHttpUrl(url) ? url : null,
    browserId: str(g.browserId, 40)
  }
}

async function readState(): Promise<HostMapFile> {
  try {
    const raw = JSON.parse(await readFile(statePath(), 'utf8')) as HostMapFile
    const groups = Array.isArray(raw.groups)
      ? raw.groups.slice(0, MAX_GROUPS).map(saneGroup).filter((g): g is HostMapGroupDto => g !== null)
      : []
    return { groups }
  } catch {
    // Chưa có file / file hỏng ⇒ danh sách rỗng (không làm app chết vì 1 file cấu hình)
    return { groups: [] }
  }
}

async function writeState(state: HostMapFile): Promise<void> {
  try {
    await writeFile(statePath(), JSON.stringify(state, null, 2), 'utf8')
  } catch (e) {
    // Log ASCII: console của main trên Windows dùng code page 437/1252
    console.error('[hostmap] cannot write hostmap.json:', e)
  }
}

async function browsers(): Promise<HostMapBrowserDto[]> {
  return detectChromiumBrowsers(
    {
      programFiles: process.env['ProgramFiles'],
      programFilesX86: process.env['ProgramFiles(x86)'],
      localAppData: process.env['LOCALAPPDATA']
    },
    exists
  )
}

/** Tổng dung lượng profile đã sinh — mỗi profile Chromium ~100-300MB nên phải cho user thấy. */
async function profilesSize(): Promise<number> {
  const walk = async (dir: string): Promise<number> => {
    let total = 0
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) total += await walk(p)
      else total += await stat(p).then((s) => s.size, () => 0)
    }
    return total
  }
  return walk(profilesRoot())
}

async function stateDto(): Promise<HostMapStateDto> {
  const [{ groups }, list, bytes] = await Promise.all([readState(), browsers(), profilesSize()])
  return { groups, browsers: list, profilesBytes: bytes }
}

/**
 * Thư mục profile cho 1 (group, target). Id do app sinh (uuid) nhưng vẫn lọc ký tự: id đi qua
 * IPC nên về nguyên tắc renderer gửi được chuỗi bất kỳ, và chuỗi đó thành ĐƯỜNG DẪN.
 */
function profileDirFor(groupId: string, targetId: string): string {
  const safe = (s: string): string => s.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60) || 'x'
  return join(profilesRoot(), `${safe(groupId)}-${safe(targetId)}`)
}

interface LaunchPlan {
  exe: string
  args: string[]
}

/** Dựng lệnh mở 1 cửa sổ cho 1 target. Throw kèm lý do người đọc hiểu được. */
function planLaunch(
  group: HostMapGroupDto,
  target: HostMapTargetDto,
  browser: HostMapBrowserDto
): LaunchPlan {
  const rules = buildHostResolverRules(group.patterns, target.ip)
  const url = group.url ?? defaultUrlFor(group.patterns)
  if (url === null) throw new Error('Chưa có domain nào trong nhóm này')
  return {
    exe: browser.exe,
    args: buildChromiumArgs({ rules, profileDir: profileDirFor(group.id, target.id), url })
  }
}

/**
 * Spawn browser tách hẳn khỏi app: `detached` + `unref` để đóng app không giết cửa sổ browser,
 * và stdio 'ignore' để pipe của browser không giữ tiến trình app sống.
 */
function launch(plan: LaunchPlan): void {
  const child = spawn(plan.exe, plan.args, { detached: true, stdio: 'ignore', windowsHide: false })
  child.on('error', (e) => {
    console.error('[hostmap] cannot launch browser:', e.message)
  })
  child.unref()
}

export function registerHostMapIpc(): void {
  const pickBrowser = (
    list: HostMapBrowserDto[],
    group: HostMapGroupDto,
    requestedId?: string
  ): HostMapBrowserDto | null => {
    const wanted = requestedId ?? group.browserId ?? null
    return (wanted !== null ? list.find((b) => b.id === wanted) : undefined) ?? list[0] ?? null
  }

  const loadGroup = async (groupId: string): Promise<{ groups: HostMapGroupDto[]; group: HostMapGroupDto }> => {
    const { groups } = await readState()
    const group = groups.find((g) => g.id === groupId)
    if (!group) throw new Error('Nhóm không tồn tại')
    if (group.patterns.length === 0) throw new Error('Nhóm chưa có domain nào')
    return { groups, group }
  }

  ipcMain.handle(IPC.HOSTMAP_STATE, async (): Promise<HostMapStateDto> => stateDto())

  ipcMain.handle(IPC.HOSTMAP_SAVE_GROUP, async (_e, input: HostMapGroupInput): Promise<HostMapStateDto> => {
    const { groups } = await readState()
    const next = saneGroup({ ...input, id: input.id ?? randomUUID() })
    if (next === null) throw new Error('Tên nhóm không hợp lệ')
    const i = groups.findIndex((g) => g.id === next.id)
    if (i >= 0) groups[i] = next
    else {
      if (groups.length >= MAX_GROUPS) throw new Error(`Tối đa ${String(MAX_GROUPS)} nhóm`)
      groups.push(next)
    }
    await writeState({ groups })
    return stateDto()
  })

  ipcMain.handle(IPC.HOSTMAP_DELETE_GROUP, async (_e, id: string): Promise<HostMapStateDto> => {
    const { groups } = await readState()
    await writeState({ groups: groups.filter((g) => g.id !== id) })
    // Profile của nhóm đã xoá không còn ai dùng → dọn luôn, đừng để chiếm hàng trăm MB
    for (const dir of await readdir(profilesRoot()).catch(() => [] as string[])) {
      if (dir.startsWith(`${id.replace(/[^A-Za-z0-9_-]/g, '')}-`)) {
        await rm(join(profilesRoot(), dir), { recursive: true, force: true }).catch(() => {})
      }
    }
    return stateDto()
  })

  ipcMain.handle(IPC.HOSTMAP_SET_ACTIVE, async (_e, groupId: string, targetId: string): Promise<HostMapStateDto> => {
    const { groups } = await readState()
    const group = groups.find((g) => g.id === groupId)
    if (group && group.targets.some((t) => t.id === targetId)) {
      group.activeTargetId = targetId
      await writeState({ groups })
    }
    return stateDto()
  })

  ipcMain.handle(
    IPC.HOSTMAP_OPEN,
    async (_e, groupId: string, opts?: { targetId?: string; browserId?: string }): Promise<HostMapOpenDto> => {
      try {
        const { group } = await loadGroup(groupId)
        const targetId = opts?.targetId ?? group.activeTargetId
        const target = group.targets.find((t) => t.id === targetId)
        if (!target) return { ok: false, error: 'Chưa chọn server đích' }
        const list = await browsers()
        const browser = pickBrowser(list, group, opts?.browserId)
        if (!browser) {
          return {
            ok: false,
            error: 'Không tìm thấy Chrome/Edge/Brave/Vivaldi trên máy — tính năng này cần browser Chromium.'
          }
        }
        await mkdir(profilesRoot(), { recursive: true })
        launch(planLaunch(group, target, browser))
        return { ok: true, opened: 1 }
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
    }
  )

  ipcMain.handle(IPC.HOSTMAP_OPEN_ALL, async (_e, groupId: string, browserId?: string): Promise<HostMapOpenDto> => {
    try {
      const { group } = await loadGroup(groupId)
      if (group.targets.length === 0) return { ok: false, error: 'Nhóm chưa có server nào' }
      const list = await browsers()
      const browser = pickBrowser(list, group, browserId)
      if (!browser) return { ok: false, error: 'Không tìm thấy browser Chromium trên máy' }
      await mkdir(profilesRoot(), { recursive: true })
      // Mỗi target 1 profile riêng ⇒ mở song song được; sai 1 target không chặn các target khác
      let opened = 0
      const errors: string[] = []
      for (const target of group.targets) {
        try {
          launch(planLaunch(group, target, browser))
          opened += 1
        } catch (e) {
          errors.push(`${target.label}: ${(e as Error).message}`)
        }
      }
      if (opened === 0) return { ok: false, error: errors.join('; ') || 'Không mở được cửa sổ nào' }
      return { ok: true, opened, ...(errors.length > 0 ? { error: errors.join('; ') } : {}) }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  ipcMain.handle(IPC.HOSTMAP_CURL, async (_e, groupId: string, targetId?: string): Promise<HostMapCurlDto> => {
    try {
      const { group } = await loadGroup(groupId)
      const target = group.targets.find((t) => t.id === (targetId ?? group.activeTargetId))
      if (!target) return { ok: false, error: 'Chưa chọn server đích' }
      const url = group.url ?? defaultUrlFor(group.patterns)
      if (url === null) return { ok: false, error: 'Chưa có domain nào trong nhóm này' }
      return { ok: true, command: buildCurlResolveCommand(group.patterns, target.ip, url) }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  ipcMain.handle(IPC.HOSTMAP_CLEAR_PROFILES, async (_e, groupId?: string): Promise<HostMapOpenDto> => {
    try {
      const root = profilesRoot()
      if (groupId === undefined) {
        await rm(root, { recursive: true, force: true })
        return { ok: true }
      }
      const prefix = `${groupId.replace(/[^A-Za-z0-9_-]/g, '')}-`
      for (const dir of await readdir(root).catch(() => [] as string[])) {
        if (dir.startsWith(prefix)) await rm(join(root, dir), { recursive: true, force: true })
      }
      return { ok: true }
    } catch (e) {
      // Browser đang mở giữ khoá file profile → nói rõ thay vì "không rõ lỗi"
      return { ok: false, error: `Không xoá được profile (đóng cửa sổ browser rồi thử lại): ${(e as Error).message}` }
    }
  })
}
