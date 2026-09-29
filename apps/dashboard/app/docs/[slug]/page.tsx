import Link from 'next/link'
import { notFound } from 'next/navigation'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { DOCS, loadDoc } from '@/lib/docs'

export function generateStaticParams() {
  return DOCS.map((d) => ({ slug: d.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const doc = DOCS.find((d) => d.slug === slug)
  return { title: doc?.title ?? 'Docs' }
}

/** Rewrites relative links between docs (e.g. `./settlement.md`) to Control Center routes. */
function resolveHref(raw: string | undefined) {
  if (!raw) return '#'
  const m = /^(?:\.\/)?([A-Za-z0-9-]+)\.md(#.*)?$/.exec(raw)
  if (m) {
    const doc = DOCS.find((d) => d.file.replace(/\.md$/, '').toLowerCase() === m[1]!.toLowerCase())
    if (doc) return `/docs/${doc.slug}${m[2] ?? ''}`
  }
  return raw
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const loaded = await loadDoc(slug)
  if (!loaded) notFound()
  const index = DOCS.findIndex((d) => d.slug === slug)
  const prev = DOCS[index - 1]
  const next = DOCS[index + 1]

  return (
    <article className="max-w-[760px]">
      <div className="prose-pact">
        <Markdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children }) => {
              const to = resolveHref(href)
              return to.startsWith('/') || to.startsWith('#') ? (
                <Link href={to}>{children}</Link>
              ) : (
                <a href={to} target="_blank" rel="noreferrer">
                  {children}
                </a>
              )
            },
          }}
        >
          {loaded.markdown}
        </Markdown>
      </div>
      <nav className="mt-12 flex justify-between gap-4 border-t border-line pt-5 text-[13px]" aria-label="Pagination">
        {prev ? (
          <Link href={`/docs/${prev.slug}`} className="text-muted hover:text-ink">
            ← {prev.title}
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link href={`/docs/${next.slug}`} className="text-right text-muted hover:text-ink">
            {next.title} →
          </Link>
        )}
      </nav>
    </article>
  )
}
