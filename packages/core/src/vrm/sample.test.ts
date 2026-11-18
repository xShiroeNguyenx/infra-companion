import { describe, expect, it } from 'vitest'
import { isRetiredSamplePath, sampleDownloadCap, sampleErrorMessage, VRM_SAMPLE_MODELS } from '@infra/shared'

describe('danh sách model mẫu', () => {
  it('mỗi model có đủ thông tin để tải và kiểm', () => {
    for (const m of VRM_SAMPLE_MODELS) {
      expect(m.id).toBeTruthy()
      expect(m.url.startsWith('https://')).toBe(true)
      // sha256 là 64 ký tự hex — sai định dạng thì mọi lượt tải đều hỏng ở bước kiểm
      expect(m.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(m.sizeBytes).toBeGreaterThan(0)
      expect(m.fileName.endsWith('.vrm')).toBe(true)
    }
  })

  it('id không trùng nhau', () => {
    expect(new Set(VRM_SAMPLE_MODELS.map((m) => m.id)).size).toBe(VRM_SAMPLE_MODELS.length)
  })

  it('luôn ghi tác giả và giấy phép', () => {
    // Repo public: đưa model của người khác vào mà không nói giấy phép là chỗ dễ sai nhất
    for (const m of VRM_SAMPLE_MODELS) {
      expect(m.author.length).toBeGreaterThan(0)
      expect(m.license.length).toBeGreaterThan(0)
      expect(m.licenseUrl.startsWith('https://')).toBe(true)
    }
  })

  it('tải qua HTTPS, không bao giờ HTTP trần', () => {
    for (const m of VRM_SAMPLE_MODELS) {
      for (const u of [m.url, ...(m.mirrors ?? [])]) expect(u.startsWith('https://')).toBe(true)
    }
  })
})

describe('trần dung lượng tải', () => {
  it('nới hơn cỡ thật để chênh lệch bình thường không bị chặn nhầm', () => {
    expect(sampleDownloadCap(10_000_000)).toBeGreaterThan(10_000_000)
  })

  it('nhưng không nới vô hạn — link chuyển hướng sai phải bị chặn', () => {
    expect(sampleDownloadCap(10_000_000)).toBeLessThan(20_000_000)
  })

  it('model nhỏ vẫn có trần tối thiểu hợp lý', () => {
    // Không có sàn thì một model 1 KB sẽ bị chặn ngay bởi phần đệm của giao thức
    expect(sampleDownloadCap(1000)).toBeGreaterThanOrEqual(1_000_000)
  })
})

describe('câu báo lỗi', () => {
  it('mỗi nguyên nhân một câu khác nhau, nói được việc phải làm', () => {
    const msgs = (['network', 'checksum', 'canceled', 'io', 'unknown'] as const).map(sampleErrorMessage)
    expect(new Set(msgs).size).toBe(msgs.length)
    for (const m of msgs) expect(m.length).toBeGreaterThan(10)
  })

  it('lỗi mã kiểm tra nói rõ file đã bị BỎ — không để user tưởng đã tải xong', () => {
    expect(sampleErrorMessage('checksum')).toMatch(/bỏ|không khớp/i)
  })
})

describe('model mẫu đã bị thu hồi', () => {
  const dir = 'C:\\Users\\deploy\\AppData\\Roaming\\app\\vrm-samples'
  const current = ['pink-pastel.vrm']

  it('model mẫu cũ trong thư mục của app → thu hồi', () => {
    expect(isRetiredSamplePath(dir + '\\sendagaya-shino.vrm', dir, current)).toBe(true)
  })

  it('model mẫu hiện hành → giữ', () => {
    expect(isRetiredSamplePath(dir + '\\pink-pastel.vrm', dir, current)).toBe(false)
  })

  it('file của USER ở chỗ khác không bao giờ bị thu hồi, kể cả trùng tên model cũ', () => {
    // Xoá nhầm ở đây là xoá file của người dùng — lỗi nặng nhất hàm này có thể gây ra
    expect(isRetiredSamplePath('D:\\models\\sendagaya-shino.vrm', dir, current)).toBe(false)
    expect(isRetiredSamplePath('D:\\models\\my-avatar.vrm', dir, current)).toBe(false)
  })

  it('thư mục chỉ TRÙNG TIỀN TỐ tên thì không tính là thư mục của app', () => {
    expect(isRetiredSamplePath(dir + '-backup\\sendagaya-shino.vrm', dir, current)).toBe(false)
  })

  it('không phân biệt hoa/thường và dấu gạch chéo (Windows trả cả hai kiểu)', () => {
    const alt = dir.replace(/\\/g, '/').toUpperCase()
    expect(isRetiredSamplePath(alt + '/Sendagaya-Shino.VRM', dir, current)).toBe(true)
    expect(isRetiredSamplePath(alt + '/PINK-PASTEL.VRM', dir, current)).toBe(false)
  })

  it('file nằm sâu hơn một cấp, hoặc thư mục rỗng → để yên', () => {
    expect(isRetiredSamplePath(dir + '\\sub\\old.vrm', dir, current)).toBe(false)
    expect(isRetiredSamplePath('sendagaya-shino.vrm', '', current)).toBe(false)
  })
})
