// Plugin mẫu "Output Highlighter" — chứng minh observe → notify → write end-to-end.

let off = null

module.exports.activate = (api) => {
  // Quan sát output mọi phiên; thấy "error"/"fail" → notify (throttle 3s để không spam).
  let last = 0
  off = api.terminal.onData(({ data }) => {
    if (/error|fail/i.test(data)) {
      const now = Date.now()
      if (now - last > 3000) {
        last = now
        void api.ui.notify('⚠ Thấy "error" trong terminal')
      }
    }
  })

  // Lệnh: lấy phiên đang active rồi gửi 1 dòng echo vào đó.
  api.commands.register('highlight.echo', 'Highlighter: Gửi echo test vào phiên active', async () => {
    const id = await api.terminal.getActiveSessionId()
    if (id) await api.terminal.write(id, 'echo "hello from plugin"\n')
    else await api.ui.notify('Không có phiên terminal đang mở')
  })
}

module.exports.deactivate = () => {
  if (off) off()
  off = null
}
