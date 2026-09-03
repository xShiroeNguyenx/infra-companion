import { describe, expect, test } from 'vitest'
import { diskVerdict, findFilesystem, type DiskUsageDto, type FilesystemDto } from '@infra/shared'

const fs = (mountedOn: string, usedKb: number, usePercent: number, availKb = 1_000_000): FilesystemDto => ({
  filesystem: `/dev/mapper${mountedOn}`,
  mountedOn,
  sizeKb: usedKb + availKb,
  usedKb,
  availKb,
  usePercent
})

const usage = (path: string, totalKb: number, children: Array<[string, number]>): DiskUsageDto => ({
  path,
  totalKb,
  entries: children
    .map(([name, sizeKb]) => ({
      path: path === '/' ? `/${name}` : `${path}/${name}`,
      name,
      sizeKb,
      percent: totalKb > 0 ? Math.round((sizeKb / totalKb) * 1000) / 10 : 0
    }))
    .sort((a, b) => b.sizeKb - a.sizeKb)
})

describe('findFilesystem', () => {
  const mounts = [fs('/', 70_000_000, 78), fs('/boot', 200_000, 40), fs('/var/lib/docker', 5_000_000, 60)]

  test('lấy mount point khớp DÀI NHẤT, không phải cái đầu tiên', () => {
    expect(findFilesystem('/var/lib/docker/overlay2', mounts)!.mountedOn).toBe('/var/lib/docker')
    expect(findFilesystem('/var/log', mounts)!.mountedOn).toBe('/')
  })

  test('khớp theo BIÊN đường dẫn, không phải startsWith trần', () => {
    // `/boot` không được nhận `/bootstrap` là nằm trong nó — nhận nhầm là kết luận nói về sai phân vùng
    expect(findFilesystem('/bootstrap', mounts)!.mountedOn).toBe('/')
  })

  test('chính mount point cũng tính là nằm trong nó', () => {
    expect(findFilesystem('/boot', mounts)!.mountedOn).toBe('/boot')
  })

  test('dấu / thừa ở cuối không làm lệch kết quả', () => {
    expect(findFilesystem('/boot/', mounts)!.mountedOn).toBe('/boot')
  })

  test('df không đọc được → null chứ không ném', () => {
    expect(findFilesystem('/var', [])).toBeNull()
  })
})

describe('diskVerdict — mức khẩn theo độ đầy phân vùng', () => {
  const u = usage('/var', 1000, [['log', 900]])

  test('≥ 90% là critical, ≥ 75% là warn, dưới nữa là ok', () => {
    expect(diskVerdict(u, [fs('/', 90_000, 92)]).level).toBe('critical')
    expect(diskVerdict(u, [fs('/', 80_000, 78)]).level).toBe('warn')
    expect(diskVerdict(u, [fs('/', 40_000, 40)]).level).toBe('ok')
  })

  test('không có df thì KHÔNG bịa mức khẩn', () => {
    const v = diskVerdict(u, [])
    expect(v.level).toBe('ok')
    expect(v.filesystem).toBeNull()
    expect(v.shareOfUsedPercent).toBeNull()
  })
})

describe('diskVerdict — việc nên làm', () => {
  const root = [fs('/', 100_000, 78)]

  test('một thư mục con áp đảo → đi tiếp vào đó', () => {
    const v = diskVerdict(usage('/var', 50_000, [['log', 48_000], ['cache', 1000]]), root)
    expect(v.advice).toBe('drillDown')
    expect(v.top!.name).toBe('log')
  })

  test('dung lượng rải rác → nói thẳng là rải rác, đừng bảo đi tiếp', () => {
    const v = diskVerdict(usage('/var', 50_000, [['a', 15_000], ['b', 14_000], ['c', 13_000], ['d', 8000]]), root)
    expect(v.advice).toBe('spread')
  })

  test('file rời ngay trong thư mục này → `du -d 1` không đi sâu hơn được nữa', () => {
    // Ca thật hay gặp: một `catalina.out` khổng lồ nằm thẳng trong thư mục, không có thư mục con nào to
    const v = diskVerdict(usage('/var/log', 50_000, [['nginx', 2000]]), root)
    expect(v.advice).toBe('filesHere')
    expect(v.looseKb).toBe(48_000)
    expect(v.loosePercent).toBe(96)
  })

  test('nhánh quá nhỏ so với phần đã dùng → đang đào nhầm chỗ', () => {
    // 500 KB trên một phân vùng đã dùng 100 GB: đào tiếp ở đây không bao giờ tìm ra chỗ đầy
    const v = diskVerdict(usage('/etc', 500, [['ssh', 300], ['pki', 100]]), [fs('/', 100_000_000, 95)])
    expect(v.advice).toBe('wrongBranch')
  })

  test('không còn thư mục con → leaf, và không tính là đào nhầm nhánh', () => {
    expect(diskVerdict(usage('/var/empty', 8, []), root).advice).toBe('leaf')
  })

  test('thư mục rỗng hoàn toàn (tổng 0) không gây chia cho 0', () => {
    const v = diskVerdict({ path: '/x', totalKb: 0, entries: [] }, root)
    expect(v.loosePercent).toBe(0)
    expect(v.shareOfUsedPercent).toBe(0)
  })

  test('tổng con vượt tổng cha (thư mục thiếu quyền bị du bỏ qua) → looseKb kẹp ở 0, không âm', () => {
    const v = diskVerdict(usage('/var', 1000, [['a', 1200]]), root)
    expect(v.looseKb).toBe(0)
    expect(v.loosePercent).toBe(0)
  })

  test('tính đúng tỉ lệ so với phần ĐÃ DÙNG của phân vùng, không phải tổng phân vùng', () => {
    const v = diskVerdict(usage('/var', 25_000, [['log', 24_000]]), [fs('/', 50_000, 78, 50_000)])
    expect(v.shareOfUsedPercent).toBe(50)
  })
})
