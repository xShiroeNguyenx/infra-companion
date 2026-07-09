import { describe, expect, it } from 'vitest'
import { applyCounterDeltas, parseMetrics, type RawCounters } from './MonitorService'

/** Output giả lập của METRIC_CMD trên 1 server thật (đủ mọi section). */
const RAW = `31.40 26.86 30.89 3/320 512212
==STAT==
cpu  100 10 50 800 20 5 5 10 0 0
procs_running 198
==MEM==
MemTotal:       49429504 kB
MemFree:        28872704 kB
MemAvailable:   40996864 kB
SwapTotal:       4194304 kB
SwapFree:        4040704 kB
==DISK==
Filesystem     1024-blocks      Used  Available Capacity Mounted on
/dev/sda1        104857600  41943040   62914560      40% /
/dev/sdb1        524288000 450971566   73316434      86% /var
tmpfs             24714752         0   24714752       0% /dev/shm
==INODE==
Filesystem       Inodes   IUsed    IFree IUse% Mounted on
/dev/sda1       6553600  786432  5767168    12% /
/dev/sdb1      32768000 3932160 28835840    12% /var
==NET==
Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 9999999    9999    0    0    0     0          0         0  9999999    9999    0    0    0     0       0          0
  eth0: 1000000   10000    0    0    0     0          0         0   500000    5000    0    0    0     0       0          0
==TCP==
1234
567
==TOP==
18.8 httpd
==UP==
35786061.90 421915986.32
==CPU==
12
==SVC==
2592000 httpd
 864000 httpd
1036800 java
    120 node`

describe('parseMetrics — format mở rộng', () => {
  it('parse đủ mọi metric tức thời', () => {
    const { sample, counters } = parseMetrics('h1', RAW)
    expect(sample.ok).toBe(true)
    expect(sample.load1).toBe(31.4)
    expect(sample.loadText).toBe('31.40 26.86 30.89')
    expect(sample.runQueue).toBe(198)
    expect(sample.memUsedPct).toBe(17) // (49429504-40996864)/49429504
    expect(sample.swapTotalMb).toBe(4096)
    expect(sample.swapUsedMb).toBe(150)
    expect(sample.diskUsedPct).toBe(86) // /var đầy nhất, tmpfs bị bỏ
    expect(sample.diskMount).toBe('/var')
    expect(sample.inodeUsedPct).toBe(12)
    expect(sample.tcpConns).toBe(1234)
    expect(sample.tcpTimeWait).toBe(567)
    expect(sample.topProc).toBe('httpd')
    expect(sample.uptimeSec).toBe(35786061)
    expect(sample.cpuCount).toBe(12)
    // services: lấy tiến trình LÂU ĐỜI nhất mỗi tên (httpd có 2 dòng → 2592000), sort giảm dần
    expect(sample.services).toEqual([
      { name: 'httpd', uptimeSec: 2592000 },
      { name: 'java', uptimeSec: 1036800 },
      { name: 'node', uptimeSec: 120 }
    ])
    // counter thô cho delta
    expect(counters.cpu).toEqual([100, 10, 50, 800, 20, 5, 5, 10, 0, 0])
    expect(counters.rxBytes).toBe(1000000) // lo bị bỏ
    expect(counters.txBytes).toBe(500000)
    // metric delta chưa có ở poll đầu
    expect(sample.cpuPct).toBeNull()
    expect(sample.netRxKbps).toBeNull()
  })

  it('applyCounterDeltas tính CPU%/net rate từ 2 bộ counter', () => {
    const { sample, counters } = parseMetrics('h1', RAW)
    // Poll trước đó 3s: tổng jiffies ít hơn 100 — us+ni 22, sy+irq+sirq 12, id 40, io 6, st 20
    const prev: RawCounters = {
      ts: counters.ts - 3000,
      cpu: [80, 8, 40, 760, 14, 3, 1, 0, 0, 0], // delta: us20 ni2 sy10 id40 io6 irq2 sirq4 st10... tổng?
      rxBytes: 625000, // delta 375000 bytes / 3s = 1000 kbps
      txBytes: 500000 // delta 0
    }
    applyCounterDeltas(sample, prev, counters)
    // delta: [20,2,10,40,6,2,4,10,0,0] tổng 94
    expect(sample.cpuUserPct).toBe(Math.round((22 / 94) * 100)) // 23
    expect(sample.cpuSystemPct).toBe(Math.round((16 / 94) * 100)) // 17
    expect(sample.cpuIowaitPct).toBe(Math.round((6 / 94) * 100)) // 6
    expect(sample.cpuStealPct).toBe(Math.round((10 / 94) * 100)) // 11
    expect(sample.cpuPct).toBe(100 - Math.round((40 / 94) * 100) - Math.round((6 / 94) * 100)) // 100-43-6=51
    expect(sample.netRxKbps).toBe(1000)
    expect(sample.netTxKbps).toBe(0)
  })

  it('prev null (poll đầu) hoặc counter tụt (reboot) → giữ null', () => {
    const { sample, counters } = parseMetrics('h1', RAW)
    applyCounterDeltas(sample, null, counters)
    expect(sample.cpuPct).toBeNull()
    // counter tụt (server reboot)
    const prevHigher: RawCounters = { ts: counters.ts - 3000, cpu: null, rxBytes: 99999999, txBytes: 99999999 }
    applyCounterDeltas(sample, prevHigher, counters)
    expect(sample.netRxKbps).toBeNull()
    expect(sample.netTxKbps).toBeNull()
  })

  it('server thiếu section mới (grep/ps không có) vẫn parse được phần cơ bản', () => {
    const minimal = `0.10 0.20 0.30 1/100 123
==STAT==
==MEM==
MemTotal: 1000000 kB
MemAvailable: 500000 kB
==DISK==
==INODE==
==NET==
==TCP==
==TOP==
==UP==
1000.5 2000.0
==CPU==
4`
    const { sample } = parseMetrics('h1', minimal)
    expect(sample.ok).toBe(true)
    expect(sample.load1).toBe(0.1)
    expect(sample.memUsedPct).toBe(50)
    expect(sample.uptimeSec).toBe(1000)
    expect(sample.cpuCount).toBe(4)
    expect(sample.diskUsedPct).toBeNull()
    expect(sample.tcpConns).toBeNull()
    expect(sample.topProc).toBeNull()
    expect(sample.services).toBeNull() // thiếu section ==SVC== (bản cũ) → null, không vỡ
  })

  it('output rác → sample lỗi', () => {
    const { sample } = parseMetrics('h1', 'command not found')
    expect(sample.ok).toBe(false)
  })
})
