import { describe, expect, test } from 'vitest'
import { allocatePort, isReserved, pickPort, type PortProbeResult } from './ports'

describe('isReserved', () => {
  // Trên máy dev thật: `netsh int ipv4 show excludedportrange protocol=tcp` giữ 50000-50059
  const reserved: Array<readonly [number, number]> = [
    [50_000, 50_059],
    [1024, 1033]
  ]

  test('nhận đúng cổng trong dải OS giữ', () => {
    expect(isReserved(50_000, reserved)).toBe(true)
    expect(isReserved(50_059, reserved)).toBe(true)
    expect(isReserved(50_030, reserved)).toBe(true)
    expect(isReserved(49_999, reserved)).toBe(false)
    expect(isReserved(50_060, reserved)).toBe(false)
  })

  test('không có dải nào → không cổng nào bị giữ', () => {
    expect(isReserved(8080, [])).toBe(false)
  })
})

describe('pickPort', () => {
  test('ưu tiên preferred khi còn rảnh', () => {
    expect(pickPort(8080, [8080, 8099], new Set())).toBe(8080)
  })

  test('preferred đã bị chiếm → lấy cổng đầu dải còn rảnh', () => {
    expect(pickPort(8080, [8080, 8099], new Set([8080]))).toBe(8081)
  })

  test('bỏ qua mọi cổng đã cấp', () => {
    expect(pickPort(null, [8080, 8099], new Set([8080, 8081, 8082]))).toBe(8083)
  })

  test('bỏ qua dải OS giữ', () => {
    expect(pickPort(null, [50_000, 50_061], new Set(), [[50_000, 50_059]])).toBe(50_060)
  })

  test('preferred nằm trong dải OS giữ thì không chọn', () => {
    expect(pickPort(50_005, [8080, 8099], new Set(), [[50_000, 50_059]])).toBe(8080)
  })

  test('preferred NGOÀI dải range vẫn được dùng nếu rảnh (port do user chỉ định)', () => {
    expect(pickPort(3307, [8080, 8099], new Set())).toBe(3307)
  })

  test('hết cổng → null (caller phải báo lỗi rõ, không im lặng)', () => {
    expect(pickPort(null, [8080, 8081], new Set([8080, 8081]))).toBeNull()
  })

  test('loại cổng không hợp lệ', () => {
    expect(pickPort(0, [8080, 8080], new Set())).toBe(8080)
    expect(pickPort(70_000, [8080, 8080], new Set())).toBe(8080)
  })
})

describe('allocatePort (probe inject — không mở socket thật)', () => {
  const free = (): Promise<PortProbeResult> => Promise.resolve({ free: true })

  test('trả cổng đầu tiên probe báo rảnh', async () => {
    const res = await allocatePort(8080, [8080, 8099], new Set(), [], free)
    expect(res.port).toBe(8080)
  })

  test('bỏ qua cổng bị chiếm rồi lấy cổng kế tiếp', async () => {
    const busy = new Set([8080, 8081])
    const probe = (p: number): Promise<PortProbeResult> =>
      Promise.resolve(busy.has(p) ? { free: false, reason: 'in-use', code: 'EADDRINUSE' } : { free: true })
    const res = await allocatePort(8080, [8080, 8099], new Set(), [], probe)
    expect(res.port).toBe(8082)
  })

  test('hết dải → port null KÈM lý do cuối để UI phân biệt được nguyên nhân', async () => {
    const probe = (): Promise<PortProbeResult> =>
      Promise.resolve({ free: false, reason: 'permission', code: 'EACCES' })
    const res = await allocatePort(8080, [8080, 8082], new Set(), [], probe)
    expect(res.port).toBeNull()
    if (res.port === null) expect(res.lastReason).toBe('permission')
  })

  test('không probe cổng đã cấp trước đó (tiết kiệm + không đụng service đang chạy)', async () => {
    const probed: number[] = []
    const probe = (p: number): Promise<PortProbeResult> => {
      probed.push(p)
      return Promise.resolve({ free: true })
    }
    await allocatePort(null, [8080, 8099], new Set([8080, 8081]), [], probe)
    expect(probed).toEqual([8082])
  })

  test('cổng trong dải OS giữ bị loại TRƯỚC khi probe (bind sẽ EACCES bí ẩn)', async () => {
    const probed: number[] = []
    const probe = (p: number): Promise<PortProbeResult> => {
      probed.push(p)
      return Promise.resolve({ free: true })
    }
    const res = await allocatePort(null, [50_000, 50_061], new Set(), [[50_000, 50_059]], probe)
    expect(res.port).toBe(50_060)
    expect(probed).toEqual([50_060])
  })
})
