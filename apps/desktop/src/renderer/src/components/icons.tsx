/**
 * Bộ icon SVG nhỏ (11–12px) dùng chung cho hàng host / header nhóm.
 *
 * Trước đây nằm hết trong `Sidebar.tsx`; tách ra vì trang **Hosts** của theme Navigator vẽ
 * lại cùng những hành động đó (ghim, ghi chú, split, SFTP, nhân bản, sửa) ở vùng chính — hai
 * nơi mà hai bộ icon lệch nhau là thứ người dùng nhìn ra ngay.
 */

export function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.3"
    >
      <path d="M8 1.7l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.9 4.2 13.5l.7-4.3-3.1-3 4.3-.6z" strokeLinejoin="round" />
    </svg>
  )
}

export function PencilIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
      <path d="M12.1 1.6a1.9 1.9 0 0 1 2.7 2.7l-8.3 8.3-3.7 1 1-3.7 8.3-8.3z" />
    </svg>
  )
}

export function FolderIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1.5 2h4l1.5 2h7.5a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" />
    </svg>
  )
}

export function CopyIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="5" y="5" width="9" height="9" rx="1.5" />
      <path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" />
    </svg>
  )
}

export function NoteIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="2.5" y="1.5" width="11" height="13" rx="1.5" />
      <path d="M5 5h6M5 8h6M5 11h4" strokeLinecap="round" />
    </svg>
  )
}

export function GridIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1.5" y="2" width="13" height="12" rx="1" />
      <path d="M8 2v12M1.5 8h13" />
    </svg>
  )
}

export function SplitIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1.5" y="2" width="13" height="12" rx="1" />
      <path d="M8 2v12" />
    </svg>
  )
}

export function TrashIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L12 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function GearIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="8" cy="8" r="2.2" />
      <path
        d="M8 1.6v1.7M8 12.7v1.7M3.5 3.5l1.2 1.2M11.3 11.3l1.2 1.2M1.6 8h1.7M12.7 8h1.7M3.5 12.5l1.2-1.2M11.3 4.7l1.2-1.2"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Hai mũi tên chụm vào / xoè ra — nút gập-mở TẤT CẢ nhóm ở hàng ô tìm. */
export function ChevronsIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
      {collapsed ? (
        // Đang gập hết → mũi tên xoè RA (bấm là mở)
        <path d="M5 6.5L8 3.5l3 3M5 9.5l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        // Đang mở → mũi tên chụm VÀO (bấm là gập)
        <path d="M5 3.5l3 3 3-3M5 12.5l3-3 3 3" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  )
}

/**
 * Mũi tên gập/mở. Quay bằng CSS transform trên cùng một hình chứ không đổi ký tự (▸/▾): hai
 * ký tự khác nhau có bề rộng khác nhau nên tên group sẽ nhích ngang mỗi lần gập.
 */
export function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 16 16"
      fill="currentColor"
      className={`text-subtle shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
      aria-hidden="true"
    >
      <path d="M5 3l7 5-7 5z" />
    </svg>
  )
}
