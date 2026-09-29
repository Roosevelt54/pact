import type { Metadata, Viewport } from 'next'
import { IBM_Plex_Mono, IBM_Plex_Sans, Instrument_Serif } from 'next/font/google'
import type { ReactNode } from 'react'

import { Shell } from '@/components/Shell'
import { EventsProvider } from '@/lib/api'

import './globals.css'

const plex = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-plex', display: 'swap' })
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '700'], variable: '--font-plex-mono', display: 'swap' })
const instrument = Instrument_Serif({ subsets: ['latin'], weight: '400', style: ['normal', 'italic'], variable: '--font-instrument', display: 'swap' })

export const metadata: Metadata = {
  title: { default: 'PACT Control Center', template: '%s · PACT' },
  description: 'PACT — the trust layer for autonomous commerce on Tempo. Pay. Prove. Settle.',
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0a0b0d' },
    { media: '(prefers-color-scheme: light)', color: '#f2efe7' },
  ],
}

const themeScript = `try{var t=localStorage.getItem('pact-theme');document.documentElement.dataset.theme=t==='light'?'light':'dark'}catch(e){document.documentElement.dataset.theme='dark'}`

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning className={`${plex.variable} ${plexMono.variable} ${instrument.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="font-sans">
        <EventsProvider>
          <Shell>{children}</Shell>
        </EventsProvider>
      </body>
    </html>
  )
}
