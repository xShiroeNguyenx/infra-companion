import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  appendAuthorizedKeyCommand,
  authKeysWriteSucceeded,
  execOnce,
  planCopyId,
  readAuthorizedKeysCommand,
  removeKeyFromAuthorized,
  writeAuthorizedKeysCommand,
  type ChainEndpoint
} from '@infra/core'
import { IPC, type CopyIdRequest, type CopyIdResult, type RotateRequest, type RotateResult } from '@infra/shared'
import { makeHostKeyVerifier, prepareConnection } from './connection'
import { getVault, touchActivity } from './vault'

const STEP_TIMEOUT_MS = 30_000

/**
 * F43 — đẩy public key lên `~/.ssh/authorized_keys` của một host, rồi XÁC MINH bằng cách
 * đăng nhập lại bằng chính key đó.
 *
 * ⚠️ Bước xác minh là bắt buộc, không phải trang trí: `authorized_keys` sai quyền thì sshd
 * **im lặng bỏ qua** — key ghi vào file thành công, lệnh trả về 0, mà đăng nhập vẫn hỏi mật
 * khẩu và không có dòng lỗi nào nói vì sao. Đúng loại "xanh nhưng không hoạt động" ở §8.
 */
export function registerCopyIdIpc(): void {
  ipcMain.handle(IPC.KEY_COPY_ID, async (event: IpcMainInvokeEvent, req: CopyIdRequest): Promise<CopyIdResult> => {
    touchActivity()
    try {
      const key = getVault()
        .listKeys()
        .find((k) => k.id === req.keyId)
      if (!key) return { ok: false, outcome: 'error', message: 'Không tìm thấy SSH key đã chọn' }

      const prepared = await prepareConnection(event.sender, req.hostId)
      const verifier = makeHostKeyVerifier(event.sender)
      const run = (command: string): ReturnType<typeof execOnce> =>
        execOnce(prepared.chain, command, verifier, { loginSteps: prepared.loginSteps, timeoutMs: STEP_TIMEOUT_MS })

      // 1) Dựng ~/.ssh với đúng quyền rồi đọc file hiện có
      const read = await run(readAuthorizedKeysCommand())
      if (read.status !== 'done' || (read.code ?? 0) !== 0) {
        return { ok: false, outcome: 'error', message: read.stderr.trim() || read.error || 'Không đọc được authorized_keys' }
      }

      // 2) So trong JS (không nhét grep/if vào shell — xem authorizedKeys.ts)
      const outcome = planCopyId(read.stdout, key.publicKey)
      if (outcome === 'added') {
        const append = await run(appendAuthorizedKeyCommand(key.publicKey))
        if (append.status !== 'done' || (append.code ?? 0) !== 0) {
          return { ok: false, outcome: 'error', message: append.stderr.trim() || append.error || 'Không ghi được key' }
        }
      }

      // 3) Xác minh: nối lại nhưng đầu CUỐI dùng key vừa đẩy. Giữ nguyên các hop —
      //    chúng có credential riêng và không liên quan tới key này.
      const material = getVault().getKeyMaterial(req.keyId)
      const verifyChain: ChainEndpoint[] = prepared.chain.map((endpoint, index) =>
        index === prepared.chain.length - 1
          ? { ...endpoint, password: undefined, useAgent: false, privateKey: material.privateKey, passphrase: material.passphrase }
          : endpoint
      )
      const probe = await execOnce(verifyChain, 'echo infra-companion-copyid-ok', verifier, {
        loginSteps: prepared.loginSteps,
        timeoutMs: STEP_TIMEOUT_MS
      })
      const verified = probe.status === 'done' && probe.stdout.includes('infra-companion-copyid-ok')

      if (!verified) {
        return {
          ok: false,
          outcome: 'not-verified',
          message:
            probe.stderr.trim() ||
            probe.error ||
            'Đã ghi key nhưng đăng nhập bằng key vẫn không được — thường là quyền thư mục ~/.ssh, hoặc sshd tắt PubkeyAuthentication.'
        }
      }

      return {
        ok: true,
        outcome,
        message:
          outcome === 'added'
            ? `Đã đẩy key "${key.label}" và đăng nhập thử bằng key thành công.`
            : `Key "${key.label}" vốn đã có sẵn trên host; đăng nhập thử bằng key thành công.`
      }
    } catch (error) {
      return { ok: false, outcome: 'error', message: error instanceof Error ? error.message : String(error) }
    }
  })

  /**
   * F42 — xoay vòng key trên MỘT host: đẩy key mới → đăng nhập thử bằng nó → chỉ khi đó mới
   * gỡ key cũ. Renderer lặp qua từng host để có tiến độ (giống màn quét gói).
   *
   * ⚠️ Bất biến quan trọng nhất: **không bao giờ gỡ key cũ khi key mới chưa đăng nhập được**.
   * Làm ngược lại là tự khoá mình ra khỏi máy, và với một fleet thì là khoá khỏi cả fleet.
   */
  ipcMain.handle(IPC.KEY_ROTATE, async (event: IpcMainInvokeEvent, req: RotateRequest): Promise<RotateResult> => {
    touchActivity()
    const label = (id: string): string => getVault().listHosts().find((h) => h.id === id)?.label ?? id
    try {
      const keys = getVault().listKeys()
      const newKey = keys.find((k) => k.id === req.newKeyId)
      const oldKey = req.oldKeyId ? keys.find((k) => k.id === req.oldKeyId) : undefined
      if (!newKey) return { hostId: req.hostId, host: label(req.hostId), stage: 'error', message: 'Không tìm thấy key mới' }

      const prepared = await prepareConnection(event.sender, req.hostId)
      const verifier = makeHostKeyVerifier(event.sender)
      const run = (command: string, chain = prepared.chain): ReturnType<typeof execOnce> =>
        execOnce(chain, command, verifier, { loginSteps: prepared.loginSteps, timeoutMs: STEP_TIMEOUT_MS })

      // 1) Đẩy key mới nếu chưa có
      const read = await run(readAuthorizedKeysCommand())
      if (read.status !== 'done' || (read.code ?? 0) !== 0) {
        return { hostId: req.hostId, host: label(req.hostId), stage: 'error', message: read.stderr.trim() || 'Không đọc được authorized_keys' }
      }
      if (planCopyId(read.stdout, newKey.publicKey) === 'added') {
        const append = await run(appendAuthorizedKeyCommand(newKey.publicKey))
        if (append.status !== 'done' || (append.code ?? 0) !== 0) {
          return { hostId: req.hostId, host: label(req.hostId), stage: 'error', message: append.stderr.trim() || 'Không ghi được key mới' }
        }
      }

      // 2) Đăng nhập thử BẰNG KEY MỚI — cửa duy nhất dẫn tới bước gỡ key cũ
      const material = getVault().getKeyMaterial(req.newKeyId)
      const verifyChain: ChainEndpoint[] = prepared.chain.map((endpoint, index) =>
        index === prepared.chain.length - 1
          ? { ...endpoint, password: undefined, useAgent: false, privateKey: material.privateKey, passphrase: material.passphrase }
          : endpoint
      )
      const probe = await run('echo infra-companion-rotate-ok', verifyChain)
      if (probe.status !== 'done' || !probe.stdout.includes('infra-companion-rotate-ok')) {
        return {
          hostId: req.hostId,
          host: label(req.hostId),
          stage: 'not-verified',
          message: probe.stderr.trim() || probe.error || 'Key mới đã ghi nhưng đăng nhập bằng nó không được — KHÔNG gỡ key cũ.'
        }
      }

      // 3) Gỡ key cũ — chỉ tới được đây khi key mới đã chứng minh là dùng được
      if (!oldKey) return { hostId: req.hostId, host: label(req.hostId), stage: 'installed', message: 'Đã đẩy và xác minh key mới.' }

      const reread = await run(readAuthorizedKeysCommand(), verifyChain)
      const without = removeKeyFromAuthorized(reread.stdout, oldKey.publicKey)
      if (without === null) {
        return { hostId: req.hostId, host: label(req.hostId), stage: 'rotated', message: 'Key mới đã xác minh; key cũ vốn không có trên máy này.' }
      }
      const write = await run(writeAuthorizedKeysCommand(without), verifyChain)
      if (!authKeysWriteSucceeded(write.stdout)) {
        return {
          hostId: req.hostId,
          host: label(req.hostId),
          stage: 'installed',
          message: write.stderr.trim() || 'Key mới đã xác minh nhưng KHÔNG gỡ được key cũ — vào máy gỡ tay.'
        }
      }
      return { hostId: req.hostId, host: label(req.hostId), stage: 'rotated', message: 'Đã đẩy key mới, xác minh, và gỡ key cũ.' }
    } catch (error) {
      return {
        hostId: req.hostId,
        host: label(req.hostId),
        stage: 'error',
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })
}
