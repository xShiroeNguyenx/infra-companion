import { describe, expect, it } from 'vitest'
import {
  cleanFolderMotions,
  DEFAULT_VRM_FOLDER_MOTIONS,
  effectiveRole,
  motionsForRole,
  nextFolderClipForRole,
  nextMotionForRole,
  VRM_MOTIONS,
  VRM_ROLE_LABELS,
  type VrmMotionRoleName
} from '@infra/shared'

/**
 * Gán vai trò tự chạy cho clip `.vrma` user tự nạp.
 *
 * App chỉ nhớ **đường dẫn + bảng vai trò**, không chép file — giấy phép bộ pixiv cấm phân phối
 * lại ở dạng trích xuất được, mà chép vào `userData` là tạo thêm đúng một bản như thế.
 */
describe('cleanFolderMotions — chuẩn hoá dữ liệu đọc từ đĩa', () => {
  it('file chưa có / JSON hỏng → mặc định rỗng, không ném lỗi', () => {
    expect(cleanFolderMotions(undefined)).toEqual(DEFAULT_VRM_FOLDER_MOTIONS)
    expect(cleanFolderMotions(null)).toEqual(DEFAULT_VRM_FOLDER_MOTIONS)
    expect(cleanFolderMotions({})).toEqual(DEFAULT_VRM_FOLDER_MOTIONS)
  })

  it('BỎ vai trò lạ thay vì giữ nguyên', () => {
    // File JSON này nằm ngoài vault, ai cũng sửa tay được. Giữ một chuỗi không thuộc
    // VrmMotionRoleName thì clip đó im lặng không bao giờ chạy và user không có cách nào biết
    // vì sao — đúng loại hỏng ở mục 8 CLAUDE.md.
    const got = cleanFolderMotions({ dir: 'D:\\clips', roles: { 'a.vrma': 'idle', 'b.vrma': 'bịa' } })
    expect(got.roles).toEqual({ 'a.vrma': 'idle' })
  })

  it('dir rỗng hoặc sai kiểu → null', () => {
    expect(cleanFolderMotions({ dir: '' }).dir).toBeNull()
    expect(cleanFolderMotions({ dir: 123 as never }).dir).toBeNull()
    expect(cleanFolderMotions({ dir: 'D:\\clips' }).dir).toBe('D:\\clips')
  })

  it('roles sai kiểu không làm hỏng cả file', () => {
    expect(cleanFolderMotions({ roles: 'bịa' as never }).roles).toEqual({})
    expect(cleanFolderMotions({ roles: { 'a.vrma': 42 as never } }).roles).toEqual({})
  })

  it('mọi vai trò trong dropdown đều qua được chuẩn hoá', () => {
    // Chốt chặn: thêm vai trò vào VRM_ROLE_LABELS mà quên thêm vào kiểu thì test này đỏ
    for (const r of VRM_ROLE_LABELS) {
      expect(cleanFolderMotions({ roles: { 'x.vrma': r.value } }).roles['x.vrma'], r.value).toBe(r.value)
    }
  })

  it('KHÔNG cho gán "manual" — không gán gì đã là "chỉ chạy khi bấm"', () => {
    expect(cleanFolderMotions({ roles: { 'a.vrma': 'manual' as never } }).roles).toEqual({})
    expect(VRM_ROLE_LABELS.some((r) => (r.value as string) === 'manual')).toBe(false)
  })
})

describe('nextFolderClipForRole — xoay vòng trong nhóm cùng vai trò', () => {
  const roles: Record<string, VrmMotionRoleName> = {
    'VRMA_01.vrma': 'idle',
    'VRMA_02.vrma': 'idle',
    'VRMA_03.vrma': 'chat'
  }
  const all = ['VRMA_01.vrma', 'VRMA_02.vrma', 'VRMA_03.vrma', 'VRMA_04.vrma']

  it('chưa chạy lần nào → lấy clip đầu của vai trò', () => {
    expect(nextFolderClipForRole(roles, all, 'idle', null)).toBe('VRMA_01.vrma')
  })

  it('xoay vòng, KHÔNG bốc ngẫu nhiên', () => {
    // Ngẫu nhiên thì có lúc ra cùng một clip hai ba lần liền; ở nhịp 90–180 giây user sẽ thấy
    // đúng cái đó lặp lại và nghĩ tính năng hỏng
    expect(nextFolderClipForRole(roles, all, 'idle', 'VRMA_01.vrma')).toBe('VRMA_02.vrma')
    expect(nextFolderClipForRole(roles, all, 'idle', 'VRMA_02.vrma')).toBe('VRMA_01.vrma')
  })

  it('vai trò chỉ có MỘT clip thì luôn ra clip đó', () => {
    expect(nextFolderClipForRole(roles, all, 'chat', null)).toBe('VRMA_03.vrma')
    expect(nextFolderClipForRole(roles, all, 'chat', 'VRMA_03.vrma')).toBe('VRMA_03.vrma')
  })

  it('không clip nào gán vai trò đó → null, để nhánh CC0 mặc định chạy tiếp', () => {
    expect(nextFolderClipForRole(roles, all, 'alert', null)).toBeNull()
    expect(nextFolderClipForRole({}, all, 'idle', null)).toBeNull()
  })

  it('clip đã gán nhưng KHÔNG còn trong thư mục → bỏ qua', () => {
    // User xoá file khỏi thư mục nhưng bảng vai trò vẫn còn khoá cũ
    expect(nextFolderClipForRole(roles, ['VRMA_03.vrma'], 'idle', null)).toBeNull()
  })

  it('clip cũ không còn trong nhóm (vừa đổi thư mục) → bắt đầu lại từ đầu', () => {
    expect(nextFolderClipForRole(roles, all, 'idle', 'da-xoa.vrma')).toBe('VRMA_01.vrma')
  })
})

/**
 * Gán ĐÈ vai trò cho 13 clip CC0.
 *
 * Trước đây vai trò của chúng nằm cứng trong `vrmMotion.ts` còn clip tự nạp thì gán được — cùng
 * một việc mà hai luật. Nay cả hai gán được; clip CC0 chỉ khác ở chỗ có **mặc định** để quay về.
 */
describe('effectiveRole / motionsForRole — gán đè vai trò clip CC0', () => {
  const clip = VRM_MOTIONS.find((c) => c.id === 'idle-01')!

  it('không gán gì → dùng vai trò mặc định của danh mục', () => {
    expect(effectiveRole(clip)).toBe(clip.role)
    expect(effectiveRole(clip, {})).toBe(clip.role)
  })

  it('gán đè → vai trò mới thắng', () => {
    expect(effectiveRole(clip, { 'idle-01': 'alert' })).toBe('alert')
  })

  it('`manual` tắt hẳn hành vi tự chạy — clip biến khỏi mọi nhóm vai trò', () => {
    // `manual` là thứ clip TỰ NẠP không cần (không gán gì đã là "chỉ khi bấm"), nhưng clip CC0
    // thì có sẵn vai trò nên phải có cách nói "đừng tự chạy nữa"
    const off = { 'idle-01': 'manual' } as const
    expect(motionsForRole('idle', off).some((c) => c.id === 'idle-01')).toBe(false)
    expect(motionsForRole('manual', off).some((c) => c.id === 'idle-01')).toBe(true)
  })

  it('clip gán đè CHUYỂN nhóm, không nằm hai nơi', () => {
    const over = { 'idle-01': 'alert' } as const
    expect(motionsForRole('idle', over).some((c) => c.id === 'idle-01')).toBe(false)
    expect(motionsForRole('alert', over).some((c) => c.id === 'idle-01')).toBe(true)
  })

  it('clip KHÁC không bị ảnh hưởng', () => {
    const over = { 'idle-01': 'alert' } as const
    // `drink-water` cũng là idle mặc định, gán đè idle-01 không được kéo nó theo
    expect(motionsForRole('idle', over).some((c) => c.id === 'drink-water')).toBe(true)
  })

  it('nextMotionForRole tôn trọng gán đè', () => {
    const over = { 'idle-01': 'alert' } as const
    const got = nextMotionForRole('alert', null, ['idle-01', 'failed-apology'], over)
    // `idle-01` nay thuộc nhóm alert nên lọt vào phép chọn
    expect(got).not.toBeNull()
    expect(['idle-01', 'failed-apology']).toContain(got!.id)
  })

  it('cleanFolderMotions giữ `manual` cho clip CC0 nhưng BỎ ở clip tự nạp', () => {
    const got = cleanFolderMotions({
      roles: { 'a.vrma': 'manual' },
      builtinRoles: { 'idle-01': 'manual', 'drink-water': 'bịa' }
    })
    expect(got.roles).toEqual({}) // clip tự nạp không nhận `manual`
    expect(got.builtinRoles).toEqual({ 'idle-01': 'manual' }) // clip CC0 thì có, giá trị lạ bị bỏ
  })
})
