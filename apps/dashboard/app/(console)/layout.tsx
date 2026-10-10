import type { ReactNode } from 'react'

import { Shell } from '@/components/Shell'
import { EventsProvider } from '@/lib/api'
import { WalletProvider } from '@/lib/wallet'

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <EventsProvider>
      <WalletProvider>
        <Shell>{children}</Shell>
      </WalletProvider>
    </EventsProvider>
  )
}
