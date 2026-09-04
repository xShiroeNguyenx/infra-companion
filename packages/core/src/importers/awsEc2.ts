import type { CloudInstanceDto } from '@infra/shared'
import { xmlBlocks, xmlText } from './xmlLite'

/**
 * AWS EC2 — phần THUẦN: body DescribeInstances + parse XML trả về thành CloudInstanceDto.
 * Ký request bằng `sync/awsSig.ts` (SigV4 dùng chung với S3); phần gọi mạng ở main.
 * Chỉ ĐỌC: DescribeInstances là API read-only, credentials chỉ cần quyền describe.
 */

export const EC2_API_VERSION = '2016-11-15'

export function ec2Host(region: string): string {
  return `ec2.${region}.amazonaws.com`
}

/** Body POST form-encoded cho DescribeInstances (không filter — phân trang mặc định 1000 máy/trang đủ dùng v1). */
export function buildDescribeInstancesBody(): string {
  return `Action=DescribeInstances&Version=${EC2_API_VERSION}`
}

/** Map trạng thái EC2 về từ vựng chung của DTO ('active' = đang chạy). */
function mapState(state: string): string {
  if (state === 'running') return 'active'
  return state // stopped/stopping/pending/shutting-down — hiện nguyên văn
}

export function parseDescribeInstances(xml: string): { instances: CloudInstanceDto[]; warnings: string[] } {
  const warnings: string[] = []
  const instances: CloudInstanceDto[] = []
  if (!xml.includes('DescribeInstancesResponse')) {
    return { instances, warnings: ['Phản hồi không phải DescribeInstancesResponse của EC2'] }
  }

  // Cấu trúc: reservationSet > item(reservation) > instancesSet > item(instance)
  for (const instancesSet of xmlBlocks(xml, 'instancesSet')) {
    for (const inst of xmlBlocks(instancesSet, 'item')) {
      const id = xmlText(inst, 'instanceId')
      if (!id) continue // item con (tagSet…) cũng là <item> — không có instanceId thì không phải instance
      const state = xmlText(xmlBlocks(inst, 'instanceState')[0] ?? '', 'name') ?? ''
      if (state === 'terminated') continue // máy đã xoá — import chỉ tạo rác

      // Tag Name làm nhãn; các tag khác giữ dạng key=value cho notes
      let name = ''
      const tags: string[] = []
      for (const tagItem of xmlBlocks(xmlBlocks(inst, 'tagSet')[0] ?? '', 'item')) {
        const key = xmlText(tagItem, 'key')
        const value = xmlText(tagItem, 'value') ?? ''
        if (key === 'Name') name = value
        else if (key) tags.push(value ? `${key}=${value}` : key)
      }

      instances.push({
        id,
        name: name || id,
        publicIp: xmlText(inst, 'ipAddress'),
        privateIp: xmlText(inst, 'privateIpAddress'),
        region: xmlText(xmlBlocks(inst, 'placement')[0] ?? '', 'availabilityZone') ?? '',
        status: mapState(state),
        tags,
        image: '',
        sizeSlug: xmlText(inst, 'instanceType') ?? '',
        exists: false
      })
    }
  }
  return { instances, warnings }
}
