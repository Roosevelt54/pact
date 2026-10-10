/** PACT mark: two brackets holding a block of value — money in escrow, bound by both parties. */
export function Mark({ size = 22, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={(size * 30) / 22} height={size} viewBox="0 0 30 22" className={className} aria-hidden>
      <path d="M7 2H2v18h5M23 2h5v18h-5" fill="none" stroke="currentColor" strokeWidth="2.6" />
      <rect x="10" y="6" width="10" height="10" className="fill-escrow" />
    </svg>
  )
}

export function Wordmark({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <Mark size={size} />
      <span className="font-extrabold tracking-[0.06em]" style={{ fontStretch: '125%', fontSize: size * 0.86 }}>
        PACT
      </span>
    </span>
  )
}
