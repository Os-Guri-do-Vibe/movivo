import { RoadmapSector } from '@/components/dashboard/roadmap-sector';

import { requireDashboardCapability } from '../../_lib/session';

export default async function AiKnowledgePage() {
  await requireDashboardCapability('control_center.ai.config.read', '/dashboard/ia/conhecimento');
  return (
    <RoadmapSector
      title="Conhecimento (RAG)"
      sprint="Sprint 10"
      what="Aqui vai ficar a base de conhecimento que a agente consulta antes de responder — metodologia, catálogo de exercícios e materiais aprovados —, com a origem de cada resposta rastreável até o documento que a sustentou."
      dependency="Depende do gate de revisão do profissional CREF: um documento só entra na base depois de revisado e aprovado por ele. Sem esse gate, a agente citaria material sem respaldo profissional — e é exatamente isso que o RAG não pode fazer."
    />
  );
}
