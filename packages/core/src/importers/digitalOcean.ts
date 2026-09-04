import type { DoDropletDto, DoImportOptions, DoImportResult } from '@infra/shared'

/**
 * F05 — Cloud import, mảnh DigitalOcean.
 *
 * Tách làm hai nửa để test được mà không cần mạng:
 * - `parseDropletsPage`: JSON một trang GET /v2/droplets → danh sách droplet chuẩn hoá.
 *   Entry thiếu id/name bị bỏ qua kèm cảnh báo chứ không làm hỏng cả trang.
 * - `importDroplets`: các droplet user ĐÃ CHỌN → host trong vault, dedupe theo địa chỉ.
 * Phần mạng (token + phân trang) nằm ở main process: apps/desktop main/ipc/digitalocean.ts.
 */

interface ParsedDropletsPage {
  droplets: DoDropletDto[]
  warnings: string[]
  /** JSON không có mảng `droplets` — phản hồi không phải của API này (sai URL/proxy chen vào). */
  malformed: boolean
}

export function parseDropletsPage(json: unknown): ParsedDropletsPage {
  const droplets: DoDropletDto[] = []
  const warnings: string[] = []
  const root = json as { droplets?: unknown } | null
  if (typeof root !== 'object' || root === null || !Array.isArray(root.droplets)) {
    return { droplets, warnings, malformed: true }
  }

  for (const raw of root.droplets) {
    const d = raw as Record<string, unknown>
    if (typeof d !== 'object' || d === null || typeof d.id !== 'number' || typeof d.name !== 'string') {
      warnings.push('Bỏ qua một mục không đúng dạng droplet trong phản hồi API')
      continue
    }
    const nets = (d.networks as { v4?: unknown } | undefined)?.v4
    const v4 = Array.isArray(nets) ? (nets as Array<Record<string, unknown>>) : []
    const ipOf = (type: string): string | null => {
      const hit = v4.find((n) => n && n.type === type && typeof n.ip_address === 'string')
      return hit ? (hit.ip_address as string) : null
    }
    const region = d.region as Record<string, unknown> | undefined
    const image = d.image as Record<string, unknown> | undefined
    droplets.push({
      id: d.id,
      name: d.name,
      publicIp: ipOf('public'),
      privateIp: ipOf('private'),
      region: typeof region?.slug === 'string' ? region.slug : '',
      status: typeof d.status === 'string' ? d.status : '',
      tags: Array.isArray(d.tags) ? d.tags.filter((t): t is string => typeof t === 'string') : [],
      image: [image?.distribution, image?.name]
        .filter((part): part is string => typeof part === 'string' && part !== '')
        .join(' '),
      sizeSlug: typeof d.size_slug === 'string' ? d.size_slug : '',
      exists: false
    })
  }
  return { droplets, warnings, malformed: false }
}

/**
 * Vault thu nhỏ đúng phần importer cần — test dùng bản giả trong RAM, khỏi mở vault thật
 * (mở vault thật = một lần argon2id ~1s). VaultService thoả interface này nguyên trạng.
 */
export interface DropletImportVault {
  listHosts(): Array<{ hostname: string }>
  listGroups(): Array<{ id: string; name: string }>
  saveGroup(input: { name: string }): { id: string; name: string }
  saveHost(input: {
    groupId: string | null
    label: string
    hostname: string
    port: number
    username: string | null
    authType: 'key' | null
    keyId: string | null
    notes?: string
  }): { id: string }
}

export const DO_DEFAULT_GROUP_NAME = 'DigitalOcean'

export function importDroplets(
  vault: DropletImportVault,
  selected: DoDropletDto[],
  options: DoImportOptions
): DoImportResult {
  const warnings: string[] = []

  // Group đích: id có sẵn → dùng; không có (hoặc id đã bị xoá giữa chừng) → theo tên.
  // Theo tên thì TÁI DÙNG group cùng tên — import lần hai phải vào đúng chỗ cũ, không đẻ
  // "DigitalOcean" thứ hai (khác chủ đích với group có dấu ngày của ssh_config: bên đó mỗi
  // lần import là một snapshot, bên này là một nguồn sống đọc lại nhiều lần).
  let groupId: string | null = null
  let groupName = ''
  if (options.groupId) {
    const found = vault.listGroups().find((g) => g.id === options.groupId)
    if (found) {
      groupId = found.id
      groupName = found.name
    } else {
      warnings.push('Group đã chọn không còn tồn tại — tạo group mới thay thế')
    }
  }
  if (!groupId) {
    const name = (options.newGroupName ?? '').trim() || DO_DEFAULT_GROUP_NAME
    const existing = vault.listGroups().find((g) => g.name === name)
    const group = existing ?? vault.saveGroup({ name })
    groupId = group.id
    groupName = group.name
  }

  // Dedupe theo địa chỉ kết nối: vault đã có host trỏ cùng địa chỉ thì bỏ qua, kể cả
  // host vừa tạo trong chính lượt import này (hai droplet chung IP private khác VPC).
  const taken = new Set(vault.listHosts().map((h) => h.hostname.trim().toLowerCase()))
  const username = options.username?.trim() ? options.username.trim() : null
  const keyId = options.keyId ?? null

  let imported = 0
  let skipped = 0
  let noIp = 0
  for (const droplet of selected) {
    const address = droplet.publicIp ?? droplet.privateIp
    if (!address) {
      noIp += 1
      continue
    }
    const key = address.trim().toLowerCase()
    if (taken.has(key)) {
      skipped += 1
      continue
    }
    vault.saveHost({
      groupId,
      label: droplet.name || address,
      hostname: address,
      port: 22,
      username,
      authType: keyId ? 'key' : null,
      keyId,
      notes: dropletNote(droplet)
    })
    taken.add(key)
    imported += 1
  }

  return { imported, skipped, noIp, groupName, warnings }
}

/** Ghi gốc gác vào notes (mã hoá trong vault) — sau này nhìn host còn biết nó từ đâu ra. */
function dropletNote(droplet: DoDropletDto): string {
  return [
    `DigitalOcean droplet #${droplet.id}`,
    droplet.region && `region ${droplet.region}`,
    droplet.image,
    droplet.tags.length > 0 ? `tags: ${droplet.tags.join(', ')}` : ''
  ]
    .filter(Boolean)
    .join(' · ')
}
