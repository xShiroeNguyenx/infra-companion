import { describe, expect, test } from 'vitest'
import {
  deletedOpenCommand,
  diskVerdict,
  findFilesystem,
  inodeCountCommand,
  isRealFilesystem,
  mountsAtOrBelow,
  mountsBelow,
  type DiskUsageDto, type FilesystemDto } from '@infra/shared'

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

describe('phân vùng gắn bên dưới — phần `du -x` không thấy', () => {
  const dev = (filesystem: string, mountedOn: string, usedKb: number, usePercent: number, availKb = 1_000_000): FilesystemDto => ({
    filesystem,
    mountedOn,
    sizeKb: usedKb + availKb,
    usedKb,
    availKb,
    usePercent
  })
  // Ca thật: `/` mới 13%, còn một ổ 500 GB gắn ở /mnt đã 99% — `du -x /` báo /mnt chỉ 4 KB
  const df = [
    dev('devtmpfs', '/dev', 0, 0),
    dev('tmpfs', '/run', 190_000, 4),
    dev('/dev/sda1', '/', 27_000_000, 13, 190_000_000),
    dev('/dev/sda14', '/boot/efi', 7_000, 12),
    dev('/dev/sdb', '/mnt/data', 495_000_000, 99, 5_500_000),
    dev('overlay', '/var/lib/docker/overlay2/abc/merged', 27_000_000, 13),
    dev('/dev/loop3', '/snap/core20/1234', 64_000, 100)
  ]

  test('liệt kê ổ thật gắn bên dưới, đầy trước; bỏ tmpfs/overlay/loop', () => {
    expect(mountsBelow('/', df).map((f) => f.mountedOn)).toEqual(['/mnt/data', '/boot/efi'])
  })

  test('snap squashfs luôn 100% không được tính là ổ thật — để lại là báo động giả mãi mãi', () => {
    expect(isRealFilesystem(dev('/dev/loop3', '/snap/x', 1, 100))).toBe(false)
    expect(isRealFilesystem(dev('/dev/sdb', '/mnt/data', 1, 1))).toBe(true)
  })

  test('đứng ở / mà ổ bên dưới 99% → khuyên đi thẳng vào ổ đó, không phải "rải rác"', () => {
    const v = diskVerdict(usage('/', 27_000_000, [['usr', 9_000_000], ['var', 8_000_000], ['mnt', 4]]), df)
    expect(v.level).toBe('ok')
    expect(v.advice).toBe('otherMount')
    expect(v.fullMountBelow!.mountedOn).toBe('/mnt/data')
  })

  test('đứng ở /mnt: du -x thấy rỗng, nhưng không được kết luận là "leaf"', () => {
    expect(diskVerdict(usage('/mnt', 4, []), df).advice).toBe('otherMount')
  })

  test('đứng TRONG chính ổ đầy thì không trỏ lại vào chính nó', () => {
    expect(mountsBelow('/mnt/data', df)).toEqual([])
    const v = diskVerdict(usage('/mnt/data', 495_000_000, [['backup', 480_000_000]]), df)
    expect(v.level).toBe('critical')
    expect(v.advice).toBe('drillDown')
  })

  test('mục con tìm ra mount nằm tại hoặc dưới nó, khớp theo biên đường dẫn', () => {
    const below = mountsBelow('/', df)
    expect(mountsAtOrBelow('/mnt', below).map((f) => f.mountedOn)).toEqual(['/mnt/data'])
    expect(mountsAtOrBelow('/mn', below)).toEqual([])
    expect(mountsAtOrBelow('/boot', below).map((f) => f.mountedOn)).toEqual(['/boot/efi'])
  })

  test('lời khuyên này không kèm lệnh — bước tiếp theo là một cú bấm trong app', () => {
    expect(diskVerdict(usage('/mnt', 4, []), df).command).toBeNull()
  })

  test('bind mount cùng thiết bị với phân vùng đang xem không bị đếm hai lần', () => {
    const withBind = [...df, dev('/dev/sda1', '/srv/bind', 27_000_000, 13)]
    expect(mountsBelow('/', withBind).map((f) => f.mountedOn)).not.toContain('/srv/bind')
  })
})

describe('phần df báo dùng mà du không đếm ra — file đã xoá còn bị giữ mở', () => {
  const GB = 1024 * 1024
  const data = (usedKb: number, usePercent = 99): FilesystemDto => ({
    filesystem: '/dev/sdb',
    mountedOn: '/mnt/data',
    sizeKb: 500 * GB,
    usedKb,
    availKb: 500 * GB - usedKb,
    usePercent
  })

  test('ở gốc phân vùng, df 495 GB mà du chỉ 120 GB → nói thẳng, kèm lệnh lsof cho đúng mount', () => {
    const v = diskVerdict(usage('/mnt/data', 120 * GB, [['mysql', 118 * GB]]), [data(495 * GB)])
    expect(v.advice).toBe('hiddenUsage')
    expect(v.hiddenKb).toBe(375 * GB)
    expect(v.command).toBe(deletedOpenCommand('/mnt/data'))
    expect(v.command).toContain('+L1')
  })

  test('đứng trước "đào nhầm nhánh": ở gốc thì "lên cấp trên" là lời khuyên vô nghĩa', () => {
    // du chỉ 5% phần đã dùng → trước đây ra wrongBranch kèm nút ↑
    expect(diskVerdict(usage('/mnt/data', 20 * GB, [['a', 19 * GB]]), [data(400 * GB, 80)]).advice).toBe('hiddenUsage')
  })

  test('chênh lệch nhỏ (journal/metadata ~1 GB) KHÔNG báo — đó là bình thường', () => {
    const v = diskVerdict(usage('/mnt/data', 494 * GB, [['mysql', 490 * GB]]), [data(495 * GB)])
    expect(v.advice).not.toBe('hiddenUsage')
    expect(v.command).toBeNull()
  })

  test('chênh lớn về GB nhưng dưới 10% phần đã dùng → không báo', () => {
    expect(diskVerdict(usage('/mnt/data', 460 * GB, [['mysql', 455 * GB]]), [data(495 * GB)]).advice).toBe('drillDown')
  })

  test('ở thư mục CON thì không so — chênh lệch khi đó chỉ là các nhánh khác', () => {
    const v = diskVerdict(usage('/mnt/data/mysql', 10 * GB, [['db', 9 * GB]]), [data(495 * GB)])
    expect(v.hiddenKb).toBe(0)
    expect(v.advice).not.toBe('hiddenUsage')
  })
})

describe('hết inode — đầy mà dung lượng còn trống', () => {
  const root = (inodeUsePercent: number | null | undefined): FilesystemDto => ({
    filesystem: '/dev/sda1',
    mountedOn: '/',
    sizeKb: 100_000_000,
    usedKb: 40_000_000,
    availKb: 60_000_000,
    usePercent: 40,
    inodeUsePercent
  })

  test('inode ≥ 90% → mức critical dù dung lượng mới 40%, kèm lệnh đếm file theo thư mục', () => {
    const v = diskVerdict(usage('/var', 30_000_000, [['lib', 29_000_000]]), [root(97)])
    expect(v.level).toBe('critical')
    expect(v.advice).toBe('inodesFull')
    expect(v.command).toBe(inodeCountCommand('/var'))
    expect(v.command).toContain('--inodes')
  })

  test('đứng trước mọi lời khuyên khác — số byte đúng nhưng không giải thích được sự cố', () => {
    const below: FilesystemDto = { ...root(1), filesystem: '/dev/sdb', mountedOn: '/var/data', usePercent: 99 }
    expect(diskVerdict(usage('/var', 30_000_000, []), [root(95), below]).advice).toBe('inodesFull')
  })

  test('inode 75–89% chỉ nâng mức lên warn, chưa đổi lời khuyên', () => {
    const v = diskVerdict(usage('/var', 30_000_000, [['lib', 29_000_000]]), [root(80)])
    expect(v.level).toBe('warn')
    expect(v.advice).toBe('drillDown')
  })

  test('không có số inode (null/thiếu) thì không bịa ra báo động', () => {
    for (const i of [null, undefined]) {
      const v = diskVerdict(usage('/var', 30_000_000, [['lib', 29_000_000]]), [root(i)])
      expect(v.level).toBe('ok')
      expect(v.advice).toBe('drillDown')
    }
  })

  test('lệnh bọc nháy đơn đường dẫn, không dùng $(…) hay backtick', () => {
    for (const cmd of [inodeCountCommand("/srv/it's"), deletedOpenCommand('/mnt/data')]) {
      expect(cmd).not.toContain('$(')
      expect(cmd).not.toContain('`')
    }
    expect(inodeCountCommand("/srv/it's")).toContain(`'\\''`)
  })
})
