import { redirect } from 'next/navigation';

/**
 * Suporte deixou de ser tela própria (US-7.1, TASK-7.1.4): virou um recorte da Base de
 * alunos sob `SUPPORT_READ`/`STUDENTS_READ`. A rota antiga segue viva como redirect
 * para não deixar link quebrado em favorito, e-mail ou histórico do navegador.
 */
export default function SupportPage() {
  redirect('/dashboard/alunos');
}
