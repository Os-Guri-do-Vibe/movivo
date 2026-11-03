import { redirect } from 'next/navigation';

/** A metodologia mora no estúdio; a base de conhecimento abre nos artigos científicos. */
export default function KnowledgeBasePage() {
  redirect('/dashboard/ia/base-conhecimento/documentos');
}
