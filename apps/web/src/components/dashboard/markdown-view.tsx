'use client';

/**
 * Leitura formatada de um texto em markdown (as fichas dos agentes). Quem usa o painel não precisa
 * saber o que é markdown: títulos viram seções, listas viram listas, **negrito** vira destaque.
 *
 * Seguro por construção: o `react-markdown` monta elementos React (nunca `innerHTML`) e NÃO
 * interpreta HTML solto, então um `<script>` colado no texto aparece como texto. Links só abrem
 * com `http(s)`, `mailto` e `tel` (o `urlTransform` padrão remove o resto, como `javascript:`).
 *
 * Os títulos descem um nível (`#` e `##` viram `h4`, `###` vira `h5`) porque o painel que contém
 * este texto já tem o nome do agente como `h2` e o rótulo da seção como `h3`.
 */
import { ArrowUpRight } from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { cn } from '@/lib/utils';

/** Título `# ...` na primeira linha: o painel já mostra o nome do agente, então não repete. */
const LEADING_TITLE = /^\s*#(?!#)[^\n]*\n+/;

const SECTION = 'mt-8 border-t border-border pt-5 text-body font-semibold tracking-tight';
const SUBSECTION = 'mt-5 text-label font-semibold';
const TEXT = 'text-label leading-relaxed text-foreground/85';
const LIST = `mt-3 space-y-1.5 pl-5 marker:text-muted-foreground ${TEXT}`;
const CELL = 'border border-border px-3 py-2 text-left align-top';

const components: Components = {
  h1: ({ children }) => <h4 className={SECTION}>{children}</h4>,
  h2: ({ children }) => <h4 className={SECTION}>{children}</h4>,
  h3: ({ children }) => <h5 className={SUBSECTION}>{children}</h5>,
  h4: ({ children }) => <h5 className={SUBSECTION}>{children}</h5>,
  // `pre-line` mantém as quebras de linha simples do texto (ex.: "Evito:" e "Prefiro:" em linhas
  // separadas), que o markdown puro juntaria num parágrafo só.
  p: ({ children }) => <p className={cn('mt-3 whitespace-pre-line', TEXT)}>{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul className={cn('list-disc', LIST)}>{children}</ul>,
  ol: ({ children }) => <ol className={cn('list-decimal', LIST)}>{children}</ol>,
  li: ({ children }) => <li className="pl-1 [&>ol]:mt-2 [&>p]:mt-0 [&>ul]:mt-2">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="mt-4 border-l-2 border-border pl-4 text-muted-foreground">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-6 border-border" />,
  code: ({ children }) => (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.8125rem]">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="mt-3 overflow-x-auto rounded-lg bg-muted p-3 text-xs [&_code]:bg-transparent [&_code]:p-0">
      {children}
    </pre>
  ),
  a: ({ href, children }) => {
    const external = href?.startsWith('https://') || href?.startsWith('http://');
    return (
      <a
        href={href}
        target={external ? '_blank' : undefined}
        rel={external ? 'noopener noreferrer' : undefined}
        className="inline-flex items-center gap-0.5 font-medium text-foreground underline underline-offset-4 hover:opacity-80"
      >
        {children}
        {external ? <ArrowUpRight aria-hidden="true" className="size-3.5" /> : null}
      </a>
    );
  },
  table: ({ children }) => (
    <div className="mt-3 overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-label">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className={cn(CELL, 'bg-muted font-medium')}>{children}</th>,
  td: ({ children }) => <td className={CELL}>{children}</td>,
};

export function MarkdownView({
  content,
  hideTitle = false,
  className,
}: {
  content: string;
  /** Esconde um `# Título` na primeira linha (o contêiner já mostra o nome). */
  hideTitle?: boolean;
  className?: string;
}) {
  const text = hideTitle ? content.replace(LEADING_TITLE, '') : content;
  return (
    <div
      data-slot="markdown-view"
      lang="pt-BR"
      className={cn(
        '[&>:first-child]:mt-0 [&>:first-child]:border-0 [&>:first-child]:pt-0',
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
