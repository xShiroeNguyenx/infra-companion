import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  appendAuthorizedKeyCommand,
  execOnce,
  planCopyId,
  readAuthorizedKeysCommand,
  type ChainEndpoint
} from '@infra/core'
import { IPC, type CopyIdRequest, type CopyIdResult } from '@infra/shared'
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
}
