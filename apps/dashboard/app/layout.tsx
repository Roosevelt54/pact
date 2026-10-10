import type { Metadata, Viewport } from 'next'
import { Archivo, JetBrains_Mono } from 'next/font/google'
import type { ReactNode } from 'react'

import './globals.css'

const archivo = Archivo({ subsets: ['latin'], axes: ['wdth'], variable: '--font-archivo', display: 'swap' })
const jetbrains = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500', '700'], variable: '--font-jetbrains', display: 'swap' })

export const metadata: Metadata = {
  title: { default: 'PACT — payment assurance for autonomous agents', template: '%s · PACT' },
  description: 'PACT escrows every agent payment on Tempo and releases it only when the delivered work passes a published policy. Pay. Prove. Settle.',
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0c0c0b' },
    { media: '(prefers-color-scheme: light)', color: '#f4f3ef' },
  ],
}

const themeScript = `try{var t=localStorage.getItem('pact-theme');document.documentElement.dataset.theme=t==='light'?'light':'dark'}catch(e){document.documentElement.dataset.theme='dark'}`

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning className={`${archivo.variable} ${jetbrains.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  )
}
