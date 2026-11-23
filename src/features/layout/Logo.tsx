/** Campervan mark: white van on a blue tile (the same artwork as public/favicon.svg). */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" className="logo">
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path
        d="M5.5 20.5v-6.2c0-1.5 1.2-2.8 2.8-2.8h9.6c1 0 1.9.5 2.5 1.3l3.3 4.3c.2.3.3.6.3 1v2.4c0 .8-.7 1.5-1.5 1.5H7c-.8 0-1.5-.7-1.5-1.5z"
        fill="#fff"
      />
      <path
        d="M8.2 13.4h3.4v3.4H8.2zM13.1 13.4h3.7v3.4h-3.7zM18.3 13.4h1.3c.4 0 .7.2.9.5l1.7 2.9h-3.9z"
        fill="var(--accent)"
      />
      <circle cx="11" cy="22" r="2.6" fill="#fff" stroke="var(--accent)" strokeWidth="1.6" />
      <circle cx="21.5" cy="22" r="2.6" fill="#fff" stroke="var(--accent)" strokeWidth="1.6" />
      <path
        d="M7 8.2c2.6-2 5.6-2 8 0"
        stroke="#fff"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeDasharray="0.1 3.2"
        opacity=".9"
      />
    </svg>
  )
}
