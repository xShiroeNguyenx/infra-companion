import { describe, expect, it } from 'vitest'
import {
  SERVICE_CATALOG,
  resolveWatchedServices,
  serviceProbes,
  nextSeenServices,
  isServiceRunning
} from '@infra/shared'
import { AlertEngine, type AlertEvent } from './AlertEngine'
import type { MetricSample } from './MonitorService'

/**
 * F71 — cảnh báo service chết.
 *
 * Trọng tâm: chỉ kêu khi service đi từ CÓ → KHÔNG trên chính host đó. Host chưa từng chạy
 * service đã tick thì phải im lặng tuyệt đối — không thì bật "dõi java" cho cả nhóm sẽ làm
 * mọi máy DB kêu liên tục, và người ta sẽ tắt luôn cảnh báo.
 */

const sample = (over: Partial<MetricSample> = {}): MetricSample => ({
  hostId: 'h1',
  ts: 1_000,
  ok: true,
  load1: 1,
  loadText: '1 1 1',
  memUsedPct: 10,
  diskUsedPct: 10,
  diskMount: '/',
  inodeUsedPct: 10,
  uptimeSec: 100,
  cpuCount: 4,
  cpuPct: 10,
  cpuUserPct: 5,
  cpuSystemPct: 5,
  cpuIowaitPct: 0,
  cpuStealPct: 0,
  runQueue: 1,
  swapUsedMb: 0,
  swapTotalMb: 0,
  netRxKbps: 0,
  netTxKbps: 0,
  tcpConns: 10,
  tcpTimeWait: 0,
  topProc: 'httpd',
  services: [],
  ...over
})

/** Ngưỡng số tắt hết — chỉ xét cảnh báo service. */
const rules = (enabledIds: string[], customNames: string[] = []) => ({
  defaults: { loadPct: null, memPct: null, diskPct: null, stealPct: null, connCount: null, offline: false },
  perHost: {},
  serviceWatch: { enabledIds, customNames }
})

/** Đẩy n sample cùng danh sách service, trả về mọi event sinh ra. */
const feed = (engine: AlertEngine, running: { name: string }[], n: number, startTs = 1_000): AlertEvent[] => {
  const events: AlertEvent[] = []
  for (let i = 0; i < n; i++) {
    events.push(...engine.onSample(sample({ ts: startTs + i * 3_000, services: running.map((r) => ({ ...r, uptimeSec: 100 })) })))
  }
  return events
}

describe('danh mục service', () => {
  it('Apache khớp cả httpd (RHEL) lẫn apache2 (Debian) — fleet trộn distro không báo nhầm', () => {
    const apache = SERVICE_CATALOG.find((c) => c.id === 'apache')!
    expect(isServiceRunning({ key: 'apache', label: '', match: apache.match }, [{ name: 'httpd' }])).toBe(true)
    expect(isServiceRunning({ key: 'apache', label: '', match: apache.match }, [{ name: 'apache2' }])).toBe(true)
    expect(isServiceRunning({ key: 'apache', label: '', match: apache.match }, [{ name: 'nginx' }])).toBe(false)
  })

  it('MySQL khớp cả mysqld lẫn mariadbd', () => {
    const mysql = SERVICE_CATALOG.find((c) => c.id === 'mysql')!
    expect(mysql.match).toContain('mysqld')
    expect(mysql.match).toContain('mariadbd')
  })

  it('id lạ (catalog đổi giữa các bản) bị bỏ, tên tự thêm rỗng cũng vậy', () => {
    const watched = resolveWatchedServices({ enabledIds: ['apache', 'khong-ton-tai'], customNames: ['  ', 'gunicorn'] })
    expect(watched.map((w) => w.key)).toEqual(['apache', 'custom:gunicorn'])
  })

  it('không nhân đôi khi id/tên bị lặp', () => {
    const watched = resolveWatchedServices({ enabledIds: ['apache', 'apache'], customNames: ['x', 'x'] })
    expect(watched).toHaveLength(2)
  })
})

describe('chỉ báo khi TỪ CÓ THÀNH KHÔNG', () => {
  it('host chưa từng chạy service đã tick → im lặng dù poll bao nhiêu lần', () => {
    const engine = new AlertEngine(rules(['java']))
    // máy DB: chỉ có mysqld, không bao giờ có java
    const events = feed(engine, [{ name: 'mysqld' }], 20)
    expect(events).toEqual([])
  })

  it('service đang chạy rồi tắt → báo chết sau 3 sample liên tiếp', () => {
    const engine = new AlertEngine(rules(['apache']))
    expect(feed(engine, [{ name: 'httpd' }], 2)).toEqual([]) // đang sống, không kêu

    const events = feed(engine, [{ name: 'mysqld' }], 3, 10_000) // httpd biến mất
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      hostId: 'h1',
      metric: 'service',
      kind: 'breach',
      service: 'Apache (httpd / apache2)'
    })
  })

  it('tắt 2 sample rồi sống lại → KHÔNG kêu (restart/deploy không phải sự cố)', () => {
    const engine = new AlertEngine(rules(['apache']))
    feed(engine, [{ name: 'httpd' }], 2)
    const down = feed(engine, [], 2, 10_000) // graceful restart: 2 nhịp không thấy tiến trình
    const up = feed(engine, [{ name: 'httpd' }], 3, 20_000)
    expect([...down, ...up]).toEqual([])
  })

  it('chết rồi sống lại → có cả breach lẫn recover', () => {
    const engine = new AlertEngine(rules(['apache']))
    feed(engine, [{ name: 'httpd' }], 2)
    const down = feed(engine, [], 3, 10_000)
    const up = feed(engine, [{ name: 'httpd' }], 2, 30_000)
    expect(down.map((e) => e.kind)).toEqual(['breach'])
    expect(up.map((e) => e.kind)).toEqual(['recover'])
  })
})

describe('không đo được ≠ đã chết', () => {
  it('services = null (ps hỏng/distro lạ) KHÔNG báo chết cả loạt', () => {
    const engine = new AlertEngine(rules(['apache', 'java']))
    feed(engine, [{ name: 'httpd' }, { name: 'java' }], 2)
    const events: AlertEvent[] = []
    for (let i = 0; i < 10; i++) {
      events.push(...engine.onSample(sample({ ts: 20_000 + i * 3_000, services: null })))
    }
    expect(events).toEqual([])
  })

  it('sample lỗi (mất kết nối) cũng không sinh cảnh báo service', () => {
    const engine = new AlertEngine(rules(['apache']))
    feed(engine, [{ name: 'httpd' }], 2)
    const events: AlertEvent[] = []
    for (let i = 0; i < 10; i++) {
      events.push(...engine.onSample(sample({ ts: 20_000 + i * 3_000, ok: false, services: null })))
    }
    expect(events.filter((e) => e.metric === 'service')).toEqual([])
  })
})

describe('nhiều service / nhiều host độc lập', () => {
  it('httpd chết không nuốt mất cảnh báo của java trên cùng host', () => {
    const engine = new AlertEngine(rules(['apache', 'java']))
    feed(engine, [{ name: 'httpd' }, { name: 'java' }], 2)
    const events = feed(engine, [], 3, 10_000)
    expect(events.map((e) => e.service).sort()).toEqual(['Apache (httpd / apache2)', 'Tomcat / app JVM (java)'])
  })

  it('mỗi host có bộ nhớ "đã từng thấy" riêng', () => {
    const engine = new AlertEngine(rules(['apache']))
    // h1 từng chạy httpd; h2 thì không bao giờ
    engine.onSample(sample({ hostId: 'h1', ts: 1_000, services: [{ name: 'httpd', uptimeSec: 9 }] }))
    const events: AlertEvent[] = []
    for (let i = 0; i < 5; i++) {
      events.push(...engine.onSample(sample({ hostId: 'h2', ts: 2_000 + i * 3_000, services: [] })))
    }
    expect(events).toEqual([]) // h2 im lặng
  })

  it('dừng theo dõi host → quên sạch, KHÔNG emit recover', () => {
    const engine = new AlertEngine(rules(['apache']))
    feed(engine, [{ name: 'httpd' }], 2)
    const down = feed(engine, [], 3, 10_000)
    expect(down).toHaveLength(1)

    engine.removeHost('h1')
    // quay lại: httpd vẫn tắt, nhưng đã quên "từng có" → im lặng như host mới
    expect(feed(engine, [], 5, 50_000)).toEqual([])
  })
})

describe('tên tự thêm + tắt tính năng', () => {
  it('tên tiến trình tự nhập hoạt động y như mục dựng sẵn', () => {
    const engine = new AlertEngine(rules([], ['gunicorn']))
    feed(engine, [{ name: 'gunicorn' }], 2)
    const events = feed(engine, [], 3, 10_000)
    expect(events[0]).toMatchObject({ metric: 'service', kind: 'breach', service: 'gunicorn' })
  })

  it('không tick gì → không bao giờ có cảnh báo service', () => {
    const engine = new AlertEngine(rules([]))
    feed(engine, [{ name: 'httpd' }], 2)
    expect(feed(engine, [], 10, 10_000)).toEqual([])
  })
})

describe('bộ nhớ "đã từng thấy"', () => {
  it('chỉ thêm, không bớt — mất đi chính là cái cần báo', () => {
    const watched = resolveWatchedServices({ enabledIds: ['apache'], customNames: [] })
    const seen = nextSeenServices([], watched, [{ name: 'httpd' }])
    expect(seen).toEqual(['apache'])
    // lần poll sau httpd biến mất → vẫn giữ dấu vết
    expect(nextSeenServices(seen, watched, [])).toEqual(['apache'])
  })

  it('service vừa xuất hiện lần đầu không sinh probe "đang tắt"', () => {
    const watched = resolveWatchedServices({ enabledIds: ['apache'], customNames: [] })
    const probes = serviceProbes(watched, [{ name: 'httpd' }], ['apache'])
    expect(probes).toEqual([{ key: 'apache', label: 'Apache (httpd / apache2)', running: true }])
  })
})
