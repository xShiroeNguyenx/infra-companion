import { describe, expect, it } from 'vitest'
import {
  clickThroughActive,
  ctrlMenuWanted,
  DEFAULT_VRM_SETTINGS,
  pointInBoxNdc,
  SEE_THROUGH_LEAVE_MS,
  seeThroughFaded
} from '@infra/shared'

describe('clickThroughActive', () => {
  const base = { setting: true, chromeless: true, settingsOpen: false, dockOpen: false }

  it('áp khi user bật và nhân vật đang đứng tự do (không khung)', () => {
    expect(clickThroughActive(base)).toBe(true)
  })

  it('không áp khi user chưa bật — mặc định là tắt', () => {
    expect(DEFAULT_VRM_SETTINGS.clickThrough).toBe(false)
    expect(clickThroughActive({ ...base, setting: false })).toBe(false)
  })

  it('không áp ở chế độ có khung: trong khung là nút và công tắc phải bấm được', () => {
    expect(clickThroughActive({ ...base, chromeless: false })).toBe(false)
  })

  it('không áp khi đang mở cài đặt: phía dưới nhân vật là chính khung cài đặt', () => {
    expect(clickThroughActive({ ...base, settingsOpen: true })).toBe(false)
  })

  it('không áp khi dock AI mở: lúc đó nhân vật đã không nhận chuột và đã mờ sẵn', () => {
    expect(clickThroughActive({ ...base, dockOpen: true })).toBe(false)
  })
})

describe('seeThroughFaded', () => {
  it('mờ khi đang áp và con trỏ nằm trên người', () => {
    expect(seeThroughFaded({ active: true, over: true, uiOpen: false })).toBe(true)
  })

  it('không mờ khi con trỏ ở ngoài người', () => {
    expect(seeThroughFaded({ active: true, over: false, uiOpen: false })).toBe(false)
  })

  it('không mờ khi menu/bảng của nhân vật đang mở — menu mở ngay trên người', () => {
    expect(seeThroughFaded({ active: true, over: true, uiOpen: true })).toBe(false)
  })

  it('không mờ khi click xuyên qua không áp', () => {
    expect(seeThroughFaded({ active: false, over: true, uiOpen: false })).toBe(false)
  })

  it('chờ một nhịp ngắn trước khi hiện lại, để lướt qua khe tay không nháy', () => {
    expect(SEE_THROUGH_LEAVE_MS).toBeGreaterThan(0)
    expect(SEE_THROUGH_LEAVE_MS).toBeLessThanOrEqual(500)
  })
})

describe('ctrlMenuWanted', () => {
  it('Ctrl + chuột phải trên người lúc đang áp → mở menu nhân vật', () => {
    expect(ctrlMenuWanted({ active: true, over: true, ctrlKey: true })).toBe(true)
  })

  it('chuột phải trần trên người → xuống app phía sau', () => {
    expect(ctrlMenuWanted({ active: true, over: true, ctrlKey: false })).toBe(false)
  })

  it('Ctrl + chuột phải ngoài người → xuống app phía sau', () => {
    expect(ctrlMenuWanted({ active: true, over: false, ctrlKey: true })).toBe(false)
  })

  it('click xuyên qua không áp → khung tự nhận chuột phải như thường, không bắt ở đây', () => {
    expect(ctrlMenuWanted({ active: false, over: true, ctrlKey: true })).toBe(false)
  })
})

describe('pointInBoxNdc', () => {
  const r = { left: 100, top: 50, width: 200, height: 400 }

  it('tâm khung là (0, 0)', () => {
    expect(pointInBoxNdc(200, 250, r)).toEqual({ nx: 0, ny: 0 })
  })

  it('trục y hướng LÊN như camera three.js: mép trên là +1, mép dưới là −1', () => {
    expect(pointInBoxNdc(100, 50, r)).toEqual({ nx: -1, ny: 1 })
    expect(pointInBoxNdc(300, 450, r)).toEqual({ nx: 1, ny: -1 })
  })

  it('khớp đúng công thức ba handler chuột của khung đang dùng', () => {
    const x = 137
    const y = 321
    const p = pointInBoxNdc(x, y, r)
    expect(p?.nx).toBeCloseTo(((x - r.left) / r.width) * 2 - 1)
    expect(p?.ny).toBeCloseTo(-(((y - r.top) / r.height) * 2 - 1))
  })

  it('ngoài khung → null, kể cả sát mép: hộp xương nới ra có thể vượt ±1', () => {
    expect(pointInBoxNdc(99, 250, r)).toBeNull()
    expect(pointInBoxNdc(301, 250, r)).toBeNull()
    expect(pointInBoxNdc(200, 49, r)).toBeNull()
    expect(pointInBoxNdc(200, 451, r)).toBeNull()
  })

  it('khung chưa có kích thước (đang nạp, canvas cao 0) → null thay vì chia cho 0', () => {
    expect(pointInBoxNdc(100, 50, { left: 100, top: 50, width: 0, height: 400 })).toBeNull()
    expect(pointInBoxNdc(100, 50, { left: 100, top: 50, width: 200, height: 0 })).toBeNull()
    expect(pointInBoxNdc(100, 50, { left: 100, top: 50, width: Number.NaN, height: 400 })).toBeNull()
  })
})
