import { redirect } from 'next/navigation';

/** As fichas passaram para a lista de agentes (Visualizar e Editar em cada linha). */
export default function AgentProfilesPage(): never {
  redirect('/dashboard/ia/agentes');
}
