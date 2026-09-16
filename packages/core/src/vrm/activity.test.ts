import { describe, expect, it } from 'vitest'
import {
  ACTIVITY_EXPRESSION,
  ACTIVITY_LABELS,
  ACTIVITY_LINES,
  activityForTool,
  activityLine,
  TOOL_ACTIVITY,
  VRM_ROLE_LABELS
} from '@infra/shared'

/**
 * Nhân vật phản ứng theo LOẠI VIỆC user đang làm.
 *
 * Trước đây chỉ hai công cụ có phản ứng (so config, replication); 43 cái còn lại mở ra thì nhân
 * vật đứng im — mà "có ai đó ở cạnh trong lúc làm việc" mới là điểm của cả tính năng.
 */
describe('TOOL_ACTIVITY — công cụ nào thuộc loại việc nào', () => {
  it('công cụ ngoài bảng → null, nhân vật không phản ứng', () => {
    // Cố ý im với Cài đặt / Trợ giúp: diễn một màn cho mỗi cú bấm là nhiễu
    expect(activityForTool('settings')).toBeNull()
    expect(activityForTool('help')).toBeNull()
    expect(activityForTool('khong-ton-tai')).toBeNull()
  })

  it('giữ nguyên hành vi cũ: so config và replication vẫn là "đọc lâu"', () => {
    expect(activityForTool('compare')).toBe('inspect')
    expect(activityForTool('replication')).toBe('inspect')
  })

  it('xếp đúng nhóm theo loại việc', () => {
    expect(activityForTool('bulk')).toBe('bulk')
    expect(activityForTool('sftp')).toBe('transfer')
    expect(activityForTool('log-tail')).toBe('logs')
    expect(activityForTool('keys')).toBe('security')
    expect(activityForTool('monitor')).toBe('monitor')
  })

  it('mọi loại việc đều có ít nhất một công cụ — không có nhóm chết', () => {
    const used = new Set(Object.values(TOOL_ACTIVITY))
    for (const { value } of ACTIVITY_LABELS) {
      expect(used.has(value), `loại việc "${value}" không công cụ nào dùng`).toBe(true)
    }
  })
})

describe('ACTIVITY_* — mỗi loại việc đủ ba thứ: nhãn, biểu cảm, câu nói', () => {
  const all = ACTIVITY_LABELS.map((l) => l.value)

  it('không loại việc nào thiếu biểu cảm hoặc câu nói', () => {
    // Thiếu thì lúc chạy nó `undefined` và nhân vật im lặng không làm gì — đúng loại hỏng ở
    // mục 8 CLAUDE.md: xanh nhưng không hoạt động
    for (const a of all) {
      expect(ACTIVITY_EXPRESSION[a]?.length, `${a}: biểu cảm`).toBeGreaterThan(0)
      expect(ACTIVITY_LINES[a]?.length, `${a}: câu nói`).toBeGreaterThan(0)
    }
  })

  it('biểu cảm luôn kết thúc bằng `neutral` — model nào cũng có cái đó', () => {
    // Model VRM khai biểu cảm rất khác nhau; danh sách phải có một cái chắc chắn tồn tại ở cuối,
    // không thì model thiếu `happy` sẽ không đổi biểu cảm gì cả
    for (const a of all) {
      expect(ACTIVITY_EXPRESSION[a].at(-1), a).toBe('neutral')
    }
  })

  it('mỗi loại việc có NHIỀU câu — một câu cố định nghe như thông báo hệ thống', () => {
    for (const a of all) {
      expect(ACTIVITY_LINES[a].length, a).toBeGreaterThanOrEqual(3)
    }
  })

  it('activityLine bốc theo rng, không vượt mảng', () => {
    expect(activityLine('logs', () => 0)).toBe(ACTIVITY_LINES.logs[0])
    // rng trả 1 (biên trên) không được cho ra `undefined`
    expect(activityLine('logs', () => 1)).toBe(ACTIVITY_LINES.logs.at(-1))
  })
})

describe('Hai bảng nhãn phải KHỚP nhau', () => {
  it('mọi loại việc đều có trong VRM_ROLE_LABELS với cùng nhãn', () => {
    /**
     * `ACTIVITY_LABELS` dùng cho bảng công cụ, `VRM_ROLE_LABELS` dùng cho dropdown gán clip —
     * hai nơi, một ý nghĩa. Lệch nhau thì user gán "Khi xem log" cho một clip rồi mở công cụ log
     * mà clip không chạy, và không có gì chỉ ra vì sao.
     */
    for (const { value, label } of ACTIVITY_LABELS) {
      const inRoles = VRM_ROLE_LABELS.find((r) => r.value === value)
      expect(inRoles, `"${value}" thiếu trong VRM_ROLE_LABELS`).toBeDefined()
      expect(inRoles!.label, `nhãn của "${value}" lệch nhau`).toBe(label)
    }
  })

  it('không nhãn nào trùng nhau — dropdown phải phân biệt được', () => {
    const labels = VRM_ROLE_LABELS.map((r) => r.label)
    expect(new Set(labels).size).toBe(labels.length)
  })
})

describe('id công cụ trong bảng phải là id THẬT', () => {
  it('không có id nào viết sai chính tả', () => {
    /**
     * Đây là chốt chặn cho loại lỗi im lặng nhất: gõ nhầm `log_tail` thay vì `log-tail` thì
     * `activityForTool` trả `null`, nhân vật không phản ứng, và không có lỗi nào được báo.
     *
     * Danh sách chép từ `toolCatalog.ts` — renderer không import được vào core, nên đây là bản
     * sao. Thêm công cụ mới vào `TOOL_ACTIVITY` mà quên thêm ở đây thì test đỏ, đúng ý.
     */
    const REAL_IDS = new Set([
      'workspaces', 'snippets', 'cmd-history', 'tunnels', 'sftp', 'folder-sync', 'recordings',
      'bulk', 'monitor', 'notifications', 'http-checks', 'inventory', 'pkg-updates', 'key-rotate',
      'jobs', 'runbooks', 'processes', 'services', 'disk-usage', 'log-tail', 'cron', 'replication',
      'compare', 'net', 'hostmap', 'ai-diagnose', 'keys', 'known-hosts', 'security', 'sync',
      'export-hosts', 'do-import', 'client-import', 'ai', 'codex', 'plugins', 'vrm', 'settings', 'help'
    ])
    for (const id of Object.keys(TOOL_ACTIVITY)) {
      expect(REAL_IDS.has(id), `"${id}" không phải id công cụ có thật`).toBe(true)
    }
  })
})
