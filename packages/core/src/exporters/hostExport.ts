import type { AuthType, GroupDto, HostDto, HostProtocol, SshKeyDto } from '@infra/shared'

/**
 * Xuất hosts ra định dạng ĐỌC ĐƯỢC (ssh_config / CSV / JSON).
 *
 * Vì sao cần: đường duy nhất lấy dữ liệu ra khỏi app trước giờ là blob mã hoá mà chỉ chính
 * app này mở được — dữ liệu vào thì được mà ra thì không. Một client "local-first" mà khoá
 * dữ liệu lại thì cũng không khác gì cloud bắt buộc.
 *
 * ⚠️ **Bản xuất CỐ Ý chỉ chứa topology kết nối, không chứa một bí mật nào**: không mật khẩu,
 * không key material, không `notes` (USER-GUIDE nói thẳng notes là chỗ người ta ghi mật khẩu
 * ứng dụng), không `env` (biến môi trường hay chứa token). Muốn bản đầy đủ thì dùng blob
 * mã hoá của Sync — đó mới là chỗ đúng cho bí mật.
 *
 * Toàn bộ file là hàm thuần: nhận DTO, trả chuỗi. Không đụng fs, không đụng vault.
 */

/** Một host đã phân giải xong kế thừa group. KHÔNG chứa bí mật. */
export interface ExportHost {
  /** Đã làm sạch + khử trùng lặp — dùng làm `Host` trong ssh_config. */
  alias: string
  /** Nhãn gốc trong app (giữ nguyên dấu tiếng Việt, khoảng trắng…). */
  label: string
  /** Đường dẫn group từ gốc xuống, vd "Production/DB". null = không thuộc group nào. */
  group: string | null
  protocol: HostProtocol
  hostname: string
  port: number
  username: string | null
  authType: AuthType | null
  /** NHÃN của key, không phải key material. null = không dùng key. */
  keyLabel: string | null
  /** Alias của các hop, đúng thứ tự `ProxyJump`. */
  jumpAliases: string[]
}

/**
 * Làm sạch nhãn thành `Host` alias dùng được.
 *
 * ssh_config tách token bằng khoảng trắng, và `*` `?` là wildcard còn `!` là phủ định —
 * để nguyên thì một nhãn như "web *" biến thành pattern khớp mọi host. Dấu tiếng Việt thì
 * GIỮ: OpenSSH khớp `Host` theo chuỗi literal nên vẫn chạy, và bóp tên của user đi thì bản
 * xuất khó đối chiếu ngược với app.
 */
export function sshAlias(label: string): string {
  const cleaned = label
    .replace(/[\p{Cc}\p{Cf}]/gu, '') // ký tự điều khiển: vô hình nhưng phá cấu trúc file
    // Bỏ ký tự nguy hiểm TRƯỚC khi ghép khoảng trắng: làm ngược lại thì "web *" ra "web-"
    .replace(/[*?!#"'`\\]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || 'host'
}

/** Gán alias cho cả danh sách, trùng thì thêm hậu tố `-2`, `-3`… (giữ nguyên thứ tự vào). */
function uniqueAliases(labels: string[]): string[] {
  const used = new Set<string>()
  return labels.map((label) => {
    const base = sshAlias(label)
    let alias = base
    let counter = 2
    while (used.has(alias)) alias = `${base}-${counter++}`
    used.add(alias)
    return alias
  })
}

/**
 * Chuỗi group từ gần nhất → gốc, giống `VaultService.groupChain`.
 * Có chặn vòng lặp: `parentId` hỏng trong DB không được làm treo bản xuất.
 */
function groupChain(groupId: string | null, byId: Map<string, GroupDto>): GroupDto[] {
  const chain: GroupDto[] = []
  const seen = new Set<string>()
  let current = groupId
  while (current && !seen.has(current)) {
    seen.add(current)
    const group = byId.get(current)
    if (!group) break
    chain.push(group)
    current = group.parentId
  }
  return chain
}

/**
 * Áp kế thừa group rồi trả về danh sách sẵn sàng để xuất.
 *
 * Kế thừa là chỗ dễ mất dữ liệu nhất khi xuất: host để `username = null` nghĩa là **lấy của
 * group**, xuất thô sẽ ra một file ssh_config thiếu `User` và không đăng nhập được. Quy tắc
 * lấy đúng như `resolveConnection`: group gần nhất có giá trị thì thắng.
 */
export function resolveForExport(hosts: HostDto[], groups: GroupDto[], keys: SshKeyDto[]): ExportHost[] {
  const groupById = new Map(groups.map((g) => [g.id, g]))
  const keyLabelById = new Map(keys.map((k) => [k.id, k.label]))
  const aliases = uniqueAliases(hosts.map((h) => h.label))
  const aliasByHostId = new Map(hosts.map((h, i) => [h.id, aliases[i]!]))

  return hosts.map((host, index) => {
    const chain = groupChain(host.groupId, groupById)
    /** Giá trị của group GẦN NHẤT có khai — giống thứ tự `chain.find` trong resolveConnection. */
    const fromGroup = <T>(pick: (g: GroupDto) => T | null): T | null =>
      chain.map(pick).find((value) => value !== null) ?? null

    const username = host.username ?? fromGroup((g) => g.username)
    const authType = host.authType ?? fromGroup((g) => g.authType)
    const keyId = host.keyId ?? fromGroup((g) => g.keyId)
    const jumpIds = host.jumpChain ?? fromGroup((g) => g.jumpChain) ?? []

    return {
      alias: aliases[index]!,
      label: host.label,
      // Chuỗi group đang là gần-nhất → gốc; hiển thị thì đảo lại cho ra "Production/DB"
      group: chain.length > 0 ? [...chain].reverse().map((g) => g.name).join('/') : null,
      protocol: host.protocol,
      hostname: host.hostname,
      port: host.port,
      username,
      authType,
      keyLabel: keyId ? (keyLabelById.get(keyId) ?? null) : null,
      // Bỏ hop trỏ vào chính nó và hop trỏ tới host không còn tồn tại
      jumpAliases: jumpIds
        .filter((id) => id !== host.id)
        .map((id) => aliasByHostId.get(id))
        .filter((a): a is string => a !== undefined)
    }
  })
}

/** Host dùng key để xác thực → bản xuất nên nhắc đặt `IdentityFile`. */
function usesKey(row: ExportHost): boolean {
  return row.keyLabel !== null && (row.authType === 'key' || row.authType === 'key+password')
}

/**
 * Sinh nội dung `~/.ssh/config`.
 *
 * Chỉ host `protocol: 'ssh'` mới có nghĩa ở đây — telnet/serial/vnc/rdp không biểu diễn được
 * bằng ssh_config, nên bị bỏ và ĐƯỢC ĐẾM vào phần đầu file thay vì biến mất im lặng.
 */
export function toSshConfig(rows: ExportHost[]): string {
  const ssh = rows.filter((r) => r.protocol === 'ssh')
  const skipped = rows.length - ssh.length

  const lines: string[] = [
    '# Sinh bởi Infra Companion — chỉ chứa thông tin kết nối.',
    '# KHÔNG chứa mật khẩu, private key, ghi chú hay biến môi trường.'
  ]
  if (skipped > 0) {
    lines.push(`# Đã bỏ ${skipped} host không phải SSH (telnet/serial/vnc/rdp) — ssh_config không mô tả được.`)
  }
  lines.push('')

  for (const row of ssh) {
    lines.push(`# ${row.label}${row.group ? ` — ${row.group}` : ''}`)
    lines.push(`Host ${row.alias}`)
    lines.push(`    HostName ${row.hostname}`)
    lines.push(`    Port ${row.port}`)
    if (row.username) lines.push(`    User ${row.username}`)
    if (row.jumpAliases.length > 0) lines.push(`    ProxyJump ${row.jumpAliases.join(',')}`)
    if (usesKey(row)) {
      // Key nằm mã hoá trong vault, KHÔNG phải file trên đĩa → không có đường dẫn thật để
      // ghi. Đoán bừa một path là tạo ra config trông chạy được nhưng thất bại lúc kết nối.
      lines.push(`    # key "${row.keyLabel}" nằm trong vault của app, không phải file trên đĩa.`)
      lines.push(`    # Xuất key ra ~/.ssh/ rồi bỏ dấu # ở dòng dưới:`)
      lines.push(`    # IdentityFile ~/.ssh/${sshAlias(row.keyLabel ?? '')}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

const CSV_COLUMNS = [
  'alias',
  'label',
  'group',
  'protocol',
  'hostname',
  'port',
  'username',
  'auth_type',
  'key_label',
  'proxy_jump'
] as const

/** Bọc ô theo RFC 4180: có dấu phẩy / nháy kép / xuống dòng thì phải quote và nhân đôi nháy. */
function csvCell(value: string | number | null): string {
  const text = value === null ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** CSV (RFC 4180, phân cách `\r\n`) — để mở bằng Excel/Sheets hoặc đưa vào script. */
export function toCsv(rows: ExportHost[]): string {
  const body = rows.map((row) =>
    [
      row.alias,
      row.label,
      row.group,
      row.protocol,
      row.hostname,
      row.port,
      row.username,
      row.authType,
      row.keyLabel,
      row.jumpAliases.join(',')
    ]
      .map(csvCell)
      .join(',')
  )
  return [CSV_COLUMNS.join(','), ...body].join('\r\n')
}

/** JSON — dạng máy đọc, giữ nguyên cấu trúc `ExportHost`. */
export function toJson(rows: ExportHost[]): string {
  return JSON.stringify({ version: 1, generator: 'infra-companion', hosts: rows }, null, 2)
}

export type ExportFormat = 'ssh_config' | 'csv' | 'json'

/** Một cửa: chọn định dạng rồi sinh chuỗi. */
export function renderExport(rows: ExportHost[], format: ExportFormat): string {
  if (format === 'csv') return toCsv(rows)
  if (format === 'json') return toJson(rows)
  return toSshConfig(rows)
}
