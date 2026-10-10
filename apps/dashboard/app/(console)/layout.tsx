import type { ReactNode } from 'react'

import { Shell } from '@/components/Shell'
import { EventsProvider } from '@/lib/api'

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <EventsProvider>
      <Shell>{children}</Shell>
    </EventsProvider>
  )
}
