import { useState } from 'react'

/** Copies text to the clipboard, saying so for a moment. */
export function CopyButton({ text, label = 'Copy', className = '' }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setDone(true)
          setTimeout(() => setDone(false), 1400)
        } catch {
          /* clipboard blocked — the text is still selectable */
        }
      }}
      className={`border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink2 transition-colors hover:border-accent hover:text-accent ${className}`}
    >
      {done ? 'Copied ✓' : label}
    </button>
  )
}
