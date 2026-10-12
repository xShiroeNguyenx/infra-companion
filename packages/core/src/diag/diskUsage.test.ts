import { describe, expect, test } from 'vitest'
import {
  BIG_FILE_MIN_KB,
  bigFilesCommand,
  dfCommand,
  dfWithInodesCommand,
  duCommand,
  formatKb,
  parentPath,
  parseBigFiles,
  parseDf,
  parseDfWithInodes,
  parseDu
} from './diskUsage'

describe('duCommand', () => {
  test('có -x (không vượt filesystem), -k (ép KB), -d 1 (một cấp)', () => {
    const cmd = duCommand('/var')
    // Thiếu -x thì `du /` bò vào /proc, /sys và mount mạng rồi trả số vô nghĩa
    expect(cmd).toContain('-x')
    expect(cmd).toContain('-k')
    expect(cmd).toContain('-d 1')
    expect(cmd).toContain("'/var'")
  })

  test('nuốt stderr để thiếu quyền một thư mục con không làm hỏng cả kết quả', () => {
    expect(duCommand('/var')).toContain('2>/dev/null')
  })

  test('bọc nháy đơn, trung hoà được nháy đơn trong tên thư mục', () => {
    expect(duCommand("/home/it's")).toContain(`'\\''`)
  })

  test('KHÔNG dùng $(…) hay backtick — mỗi hop login-script bóc mất một lớp quote', () => {
    for (const cmd of [duCommand('/var'), dfCommand(), dfWithInodesCommand(), bigFilesCommand('/var')]) {
      expect(cmd).not.toContain('$(')
      expect(cmd).not.toContain('`')
    }
  })
})

describe('parseDu', () => {
  const SAMPLE = `4       /var/tmp
1048576 /var/log
2097152 /var/lib
16      /var/cache
3145764 /var
`

  test('tổng lấy từ DÒNG CHÍNH nó, không phải cộng các con', () => {
    // Cộng con lại sẽ thiếu phần file nằm ngay trong thư mục — thường chính là thứ chiếm chỗ
    const usage = parseDu(SAMPLE, '/var')
    expect(usage.totalKb).toBe(3_145_764)
    expect(usage.entries.reduce((s, e) => s + e.sizeKb, 0)).toBeLessThan(usage.totalKb)
  })

  test('con xếp lớn trước, có tên ngắn và phần trăm theo cấp này', () => {
    const usage = parseDu(SAMPLE, '/var')
    expect(usage.entries.map((e) => e.name)).toEqual(['lib', 'log', 'cache', 'tmp'])
    expect(usage.entries[0]!.percent).toBeCloseTo(66.7, 1)
  })

  test('bản thân thư mục không lọt vào danh sách con', () => {
    expect(parseDu(SAMPLE, '/var').entries.some((e) => e.path === '/var')).toBe(false)
  })

  test('gốc `/` cho tên con không có dấu gạch thừa', () => {
    const usage = parseDu('100 /etc\n200 /var\n300 /\n', '/')
    expect(usage.path).toBe('/')
    expect(usage.entries.map((e) => e.name)).toEqual(['var', 'etc'])
  })

  test('path có khoảng trắng vẫn tách đúng', () => {
    const usage = parseDu('512 /srv/my data\n1024 /srv\n', '/srv')
    expect(usage.entries[0]).toMatchObject({ path: '/srv/my data', name: 'my data', sizeKb: 512 })
  })

  test('dấu / thừa ở cuối được chuẩn hoá, không thành thư mục khác', () => {
    expect(parseDu(SAMPLE, '/var/').totalKb).toBe(3_145_764)
  })

  test('output rỗng hoặc rác → tổng 0, không ném', () => {
    expect(parseDu('', '/var')).toEqual({ path: '/var', totalKb: 0, entries: [] })
    expect(parseDu('du: cannot read\n', '/var').entries).toEqual([])
  })

  test('tổng 0 thì phần trăm là 0 chứ không phải NaN/Infinity', () => {
    const usage = parseDu('500 /var/log\n', '/var')
    expect(usage.entries[0]!.percent).toBe(0)
  })
})

describe('parseDf', () => {
  const SAMPLE = `Filesystem     1024-blocks      Used Available Capacity Mounted on
/dev/sda1         41152000  38000000   1052000      98% /
tmpfs              2048000         0   2048000       0% /dev/shm
/dev/sdb1        104857600  20971520  83886080      20% /mnt/my data
`

  test('đọc đủ các cột và giữ điểm gắn có khoảng trắng', () => {
    const rows = parseDf(SAMPLE)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ filesystem: '/dev/sda1', usePercent: 98, mountedOn: '/', availKb: 1_052_000 })
    expect(rows[2]!.mountedOn).toBe('/mnt/my data')
  })

  test('bỏ dòng tiêu đề, không tính thành một filesystem', () => {
    expect(parseDf(SAMPLE).some((r) => r.filesystem === 'Filesystem')).toBe(false)
  })

  test('output rỗng → mảng rỗng', () => {
    expect(parseDf('')).toEqual([])
  })
})

describe('parseDfWithInodes', () => {
  const blocks = `Filesystem     1024-blocks      Used Available Capacity Mounted on
/dev/sda1         41152000  20000000  21152000      49% /
/dev/sdb1        104857600  20971520  83886080      20% /mnt/my data
/dev/sdc1           524288     10000    514288       2% /boot/efi
`
  const inodes = `Filesystem      Inodes   IUsed   IFree IUse% Mounted on
/dev/sda1      2621440 2595000   26440   99% /
/dev/sdb1      6553600   12000 6541600    1% /mnt/my data
/dev/sdc1            0       0       0     - /boot/efi
`
  const marker = dfWithInodesCommand().match(/echo (\S+)/)![1]!

  test('ghép % inode vào đúng phân vùng theo điểm gắn (kể cả điểm gắn có khoảng trắng)', () => {
    const rows = parseDfWithInodes(`${blocks}${marker}\n${inodes}`)
    expect(rows).toHaveLength(3)
    // Ca kinh điển: dung lượng mới 49% mà inode đã 99%
    expect(rows[0]).toMatchObject({ mountedOn: '/', usePercent: 49, inodeUsePercent: 99, inodesFree: 26_440 })
    expect(rows[1]).toMatchObject({ mountedOn: '/mnt/my data', inodeUsePercent: 1 })
  })

  test('filesystem không có inode cố định (vfat/btrfs, IUse% = "-") → null, không phải 0%', () => {
    expect(parseDfWithInodes(`${blocks}${marker}\n${inodes}`)[2]!.inodeUsePercent).toBeNull()
  })

  test('phần inode hỏng/thiếu vẫn giữ nguyên dung lượng — không mất cả màn vì thiếu một cột', () => {
    const rows = parseDfWithInodes(`${blocks}${marker}\n`)
    expect(rows).toHaveLength(3)
    expect(rows[0]!.inodeUsePercent).toBeUndefined()
    expect(parseDfWithInodes(blocks)).toHaveLength(3)
  })

  test('dòng inode KHÔNG bị đọc nhầm thành phân vùng thứ hai', () => {
    // Không có marker thì regex của parseDf khớp cả dòng `df -i` → mỗi phân vùng ra 2 lần
    expect(parseDfWithInodes(`${blocks}${marker}\n${inodes}`).filter((r) => r.mountedOn === '/')).toHaveLength(1)
  })
})

describe('bigFilesCommand / parseBigFiles', () => {
  test('-xdev (như du -x), lọc ngưỡng ngay ở find, giới hạn số dòng', () => {
    const cmd = bigFilesCommand('/var/log')
    expect(cmd).toContain('-xdev')
    expect(cmd).toContain(`-size +${BIG_FILE_MIN_KB}k`)
    expect(cmd).toContain('head -n 20')
    expect(cmd).toContain("'/var/log'")
  })

  test('đọc size + mtime + path, path có khoảng trắng giữ nguyên, tên tính từ thư mục đang xem', () => {
    const files = parseBigFiles(
      '204800 1760000000.5 /var/log/app/old dump.sql\n9437184 1760001000.0 /var/log/catalina.out\n',
      '/var/log'
    )
    expect(files[0]).toMatchObject({ name: 'catalina.out', sizeKb: 9_437_184, mtimeMs: 1_760_001_000_000 })
    expect(files[1]!.name).toBe('app/old dump.sql')
    expect(files[1]!.path).toBe('/var/log/app/old dump.sql')
  })

  test('ở gốc / thì tên bỏ dấu / đầu', () => {
    expect(parseBigFiles('60000 1 /swapfile\n', '/')[0]!.name).toBe('swapfile')
  })

  test('output rỗng (không có file nào vượt ngưỡng) → mảng rỗng, không lỗi', () => {
    expect(parseBigFiles('', '/var')).toEqual([])
  })
})

describe('parentPath', () => {
  test('lên một cấp', () => {
    expect(parentPath('/var/log/nginx')).toBe('/var/log')
    expect(parentPath('/var')).toBe('/')
  })

  test('ở gốc rồi thì không lên được nữa', () => {
    expect(parentPath('/')).toBeNull()
    expect(parentPath('')).toBeNull()
  })

  test('dấu / thừa ở cuối không tạo ra một cấp ảo', () => {
    expect(parentPath('/var/log/')).toBe('/var')
  })
})

describe('formatKb', () => {
  test('lên đơn vị theo 1024 (du -k đếm KiB)', () => {
    expect(formatKb(512)).toBe('512 KB')
    expect(formatKb(1024)).toBe('1.0 MB')
    expect(formatKb(1_048_576)).toBe('1.0 GB')
    expect(formatKb(1_073_741_824)).toBe('1.0 TB')
  })

  test('số lớn bỏ phần thập phân cho đỡ rối', () => {
    expect(formatKb(150 * 1024)).toBe('150 MB')
  })

  test('0 vẫn ra chuỗi hợp lệ', () => {
    expect(formatKb(0)).toBe('0 KB')
  })
})
