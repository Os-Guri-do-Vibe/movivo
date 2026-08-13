import { RoadmapSector } from '@/components/dashboard/roadmap-sector';

import { requireDashboardCapability } from '../../_lib/session';

export default async function AiFaqPage() {
  await requireDashboardCapability('control_center.ai.config.read', '/dashboard/ia/faq');
  return (
    <RoadmapSector
      title="FAQ"
      sprint="Sprint 8"
      what="Aqui vão ficar as perguntas frequentes com resposta pré-aprovada: dúvidas repetidas (cobrança, cancelamento, como funciona o check-in) respondidas com texto revisado, sem passar por geração de LLM."
      dependency="Depende da mesma fundação de configuração publicada da persona (agent_config): cada resposta de FAQ é publicada com versão, autoria e motivo, e volta atrás em um clique como qualquer outra configuração de IA."
    />
  );
}
