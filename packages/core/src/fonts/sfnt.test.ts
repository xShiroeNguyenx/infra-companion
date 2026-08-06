import { describe, expect, it } from 'vitest'
import {
  detectFontContainer,
  isAddableFontBytes,
  isScannableFontFile,
  parseFamilyFromNameTable,
  parseTableDirectory,
  sfntNumTables,
  ttcFontOffsets,
  ttcNumFonts,
  SFNT_HEADER_BYTES
} from './sfnt'

interface NameRecord {
  platformId: number
  encodingId: number
  nameId: number
  text: string
}

/** Dựng bảng `name` đúng bố cục thật để test parser trên dữ liệu hợp lệ. */
function buildNameTable(records: NameRecord[]): Uint8Array {
  const encoded = records.map((r) => {
    if (r.platformId === 1 && r.encodingId === 0) {
      return Uint8Array.from([...r.text].map((c) => c.charCodeAt(0) & 0xff))
    }
    const out = new Uint8Array(r.text.length * 2)
    for (let i = 0; i < r.text.length; i++) {
      const code = r.text.charCodeAt(i)
      out[i * 2] = code >> 8
      out[i * 2 + 1] = code & 0xff
    }
    return out
  })

  const stringOffset = 6 + records.length * 12
  const stringsLen = encoded.reduce((n, e) => n + e.length, 0)
  const buf = new Uint8Array(stringOffset + stringsLen)
  const put16 = (at: number, v: number): void => {
    buf[at] = v >> 8
    buf[at + 1] = v & 0xff
  }

  put16(0, 0) // format
  put16(2, records.length)
  put16(4, stringOffset)

  let cursor = 0
  records.forEach((r, i) => {
    const at = 6 + i * 12
    put16(at, r.platformId)
    put16(at + 2, r.encodingId)
    put16(at + 4, 0) // languageID
    put16(at + 6, r.nameId)
    put16(at + 8, encoded[i].length)
    put16(at + 10, cursor)
    buf.set(encoded[i], stringOffset + cursor)
    cursor += encoded[i].length
  })
  return buf
}

/** Dựng file sfnt tối giản chứa đúng một bảng `name`. */
function buildSfnt(nameTable: Uint8Array): Uint8Array {
  const dirLen = SFNT_HEADER_BYTES + 16
  const buf = new Uint8Array(dirLen + nameTable.length)
  const put16 = (at: number, v: number): void => {
    buf[at] = v >> 8
    buf[at + 1] = v & 0xff
  }
  const put32 = (at: number, v: number): void => {
    buf[at] = (v >>> 24) & 0xff
    buf[at + 1] = (v >>> 16) & 0xff
    buf[at + 2] = (v >>> 8) & 0xff
    buf[at + 3] = v & 0xff
  }

  put32(0, 0x00010000) // sfntVersion TrueType 1.0
  put16(4, 1) // numTables
  buf.set(Uint8Array.from([0x6e, 0x61, 0x6d, 0x65]), SFNT_HEADER_BYTES) // 'name'
  put32(SFNT_HEADER_BYTES + 4, 0) // checksum
  put32(SFNT_HEADER_BYTES + 8, dirLen) // offset
  put32(SFNT_HEADER_BYTES + 12, nameTable.length)
  buf.set(nameTable, dirLen)
  return buf
}

describe('detectFontContainer', () => {
  it('nhận đúng từng loại container', () => {
    expect(detectFontContainer(Uint8Array.from([0x00, 0x01, 0x00, 0x00]))).toBe('sfnt')
    expect(detectFontContainer(new TextEncoder().encode('OTTO'))).toBe('sfnt')
    expect(detectFontContainer(new TextEncoder().encode('ttcf'))).toBe('ttc')
    expect(detectFontContainer(new TextEncoder().encode('wOFF'))).toBe('woff')
    expect(detectFontContainer(new TextEncoder().encode('wOF2'))).toBe('woff2')
  })

  it('file không phải font → unknown (PNG, rỗng, quá ngắn)', () => {
    expect(detectFontContainer(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBe('unknown')
    expect(detectFontContainer(new Uint8Array(0))).toBe('unknown')
    expect(detectFontContainer(Uint8Array.from([0x00, 0x01]))).toBe('unknown')
  })
})

describe('parseTableDirectory', () => {
  it('tìm được vị trí bảng name trong file sfnt', () => {
    const file = buildSfnt(buildNameTable([{ platformId: 3, encodingId: 1, nameId: 1, text: 'Test Mono' }]))
    expect(sfntNumTables(file)).toBe(1)
    const tables = parseTableDirectory(file, 1)
    expect(tables).toHaveLength(1)
    expect(tables[0].tag).toBe('name')

    const name = file.subarray(tables[0].offset, tables[0].offset + tables[0].length)
    expect(parseFamilyFromNameTable(name)).toBe('Test Mono')
  })

  it('numTables vô lý từ file rác → 0, không đọc tiếp', () => {
    const junk = new Uint8Array(64)
    junk[4] = 0xff
    junk[5] = 0xff
    expect(sfntNumTables(junk)).toBe(0)
  })
})

describe('parseFamilyFromNameTable', () => {
  it('nameID 16 (Typographic Family) THẮNG nameID 1', () => {
    // Font nhiều nét khai nameID 1 = "Roboto Light" nhưng họ thật là "Roboto"
    const table = buildNameTable([
      { platformId: 3, encodingId: 1, nameId: 1, text: 'Roboto Light' },
      { platformId: 3, encodingId: 1, nameId: 16, text: 'Roboto' }
    ])
    expect(parseFamilyFromNameTable(table)).toBe('Roboto')
  })

  it('thứ tự bản ghi không ảnh hưởng kết quả', () => {
    const table = buildNameTable([
      { platformId: 3, encodingId: 1, nameId: 16, text: 'Roboto' },
      { platformId: 3, encodingId: 1, nameId: 1, text: 'Roboto Light' }
    ])
    expect(parseFamilyFromNameTable(table)).toBe('Roboto')
  })

  it('chỉ có bản ghi Mac 1-byte vẫn đọc được', () => {
    const table = buildNameTable([{ platformId: 1, encodingId: 0, nameId: 1, text: 'Monaco' }])
    expect(parseFamilyFromNameTable(table)).toBe('Monaco')
  })

  it('ưu tiên platform Windows khi cùng nameID', () => {
    const table = buildNameTable([
      { platformId: 1, encodingId: 0, nameId: 1, text: 'Mac Name' },
      { platformId: 3, encodingId: 1, nameId: 1, text: 'Win Name' }
    ])
    expect(parseFamilyFromNameTable(table)).toBe('Win Name')
  })

  it('bỏ nameID không phải tên họ (vd nameID 4 full name)', () => {
    const table = buildNameTable([{ platformId: 3, encodingId: 1, nameId: 4, text: 'Something Regular' }])
    expect(parseFamilyFromNameTable(table)).toBeNull()
  })

  it('loại tên rác: ký tự điều khiển, quá ngắn, quá dài', () => {
    expect(
      parseFamilyFromNameTable(buildNameTable([{ platformId: 3, encodingId: 1, nameId: 1, text: 'AB' }]))
    ).toBeNull()
    expect(
      parseFamilyFromNameTable(buildNameTable([{ platformId: 3, encodingId: 1, nameId: 1, text: 'X' }]))
    ).toBeNull()
    expect(
      parseFamilyFromNameTable(buildNameTable([{ platformId: 3, encodingId: 1, nameId: 1, text: 'z'.repeat(80) }]))
    ).toBeNull()
  })

  it('bảng hỏng / rỗng → null, KHÔNG ném', () => {
    expect(parseFamilyFromNameTable(new Uint8Array(0))).toBeNull()
    expect(parseFamilyFromNameTable(new Uint8Array(6))).toBeNull()
    // count khai 3 bản ghi nhưng không có dữ liệu theo sau
    const lying = new Uint8Array(6)
    lying[3] = 3
    expect(parseFamilyFromNameTable(lying)).toBeNull()
  })

  it('offset chuỗi trỏ ra ngoài bảng → bỏ bản ghi đó', () => {
    const table = buildNameTable([{ platformId: 3, encodingId: 1, nameId: 1, text: 'Good Font' }])
    // Đẩy offset chuỗi ra quá cuối bảng
    table[6 + 10] = 0xff
    table[6 + 11] = 0xff
    expect(parseFamilyFromNameTable(table)).toBeNull()
  })

  it('giữ được tên có dấu (UTF-16)', () => {
    const table = buildNameTable([{ platformId: 3, encodingId: 1, nameId: 1, text: 'Phông Việt' }])
    expect(parseFamilyFromNameTable(table)).toBe('Phông Việt')
  })
})

describe('ttc collection', () => {
  it('đọc được số font + offset từng font', () => {
    const buf = new Uint8Array(12 + 8)
    buf.set(new TextEncoder().encode('ttcf'), 0)
    buf[11] = 2 // numFonts = 2
    buf[15] = 100 // offset font 1
    buf[19] = 200 // offset font 2
    expect(detectFontContainer(buf)).toBe('ttc')
    expect(ttcNumFonts(buf)).toBe(2)
    expect(ttcFontOffsets(buf, 2)).toEqual([100, 200])
  })

  it('numFonts vô lý → 0', () => {
    const buf = new Uint8Array(20)
    buf.set(new TextEncoder().encode('ttcf'), 0)
    buf[8] = 0xff
    expect(ttcNumFonts(buf)).toBe(0)
  })
})

describe('lọc file', () => {
  it('isScannableFontFile theo đuôi, không phân biệt hoa thường', () => {
    expect(isScannableFontFile('CascadiaMono.ttf')).toBe(true)
    expect(isScannableFontFile('Font.OTF')).toBe(true)
    expect(isScannableFontFile('NotoCJK.ttc')).toBe(true)
    expect(isScannableFontFile('vga.fon')).toBe(false)
    expect(isScannableFontFile('readme.txt')).toBe(false)
    // woff không quét vì bảng bên trong đã nén
    expect(isScannableFontFile('web.woff2')).toBe(false)
  })

  it('isAddableFontBytes tin MAGIC BYTE chứ không tin đuôi file', () => {
    expect(isAddableFontBytes(new TextEncoder().encode('OTTO'))).toBe(true)
    expect(isAddableFontBytes(new TextEncoder().encode('wOF2'))).toBe(true)
    // File PNG đổi tên thành .ttf phải bị chặn
    expect(isAddableFontBytes(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBe(false)
    expect(isAddableFontBytes(new Uint8Array(0))).toBe(false)
  })
})
