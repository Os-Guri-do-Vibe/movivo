/**
 * Configuração institucional da landing: navegação, canais oficiais e o Responsável
 * Técnico. Tudo que é fato (número de CREF, links legais) fica aqui e só aparece na
 * página quando estiver preenchido — nenhum componente inventa credencial ou link.
 */
export const SECTION_IDS = {
  top: 'topo',
  manifesto: 'manifesto',
  system: 'sistema',
  whatsapp: 'whatsapp',
  howItWorks: 'como-funciona',
  technology: 'tecnologia',
  muscleMap: 'mapa-muscular',
  adaptive: 'treino-adaptativo',
  day: 'um-dia',
  club: 'club',
  pricing: 'planos',
  finalCta: 'comecar',
} as const;

export const PRICING_HASH = `#${SECTION_IDS.pricing}`;

export const NAV_LINKS = [
  { label: 'Como funciona', href: `#${SECTION_IDS.howItWorks}` },
  { label: 'Tecnologia', href: `#${SECTION_IDS.technology}` },
  { label: 'MOVIVO Club', href: `#${SECTION_IDS.club}` },
  { label: 'Planos', href: PRICING_HASH },
] as const;

/** Colunas do rodapé: só âncoras de seções que existem nesta página. */
export const FOOTER_COLUMNS = [
  {
    title: 'Produto',
    links: [
      { label: 'Como funciona', href: `#${SECTION_IDS.howItWorks}` },
      { label: 'Treino no WhatsApp', href: `#${SECTION_IDS.whatsapp}` },
      { label: 'Treino adaptativo', href: `#${SECTION_IDS.adaptive}` },
      { label: 'Planos', href: PRICING_HASH },
    ],
  },
  {
    title: 'Ciência',
    links: [
      { label: 'O sistema MOVIVO', href: `#${SECTION_IDS.system}` },
      { label: 'Tecnologia', href: `#${SECTION_IDS.technology}` },
      { label: 'Mapa muscular', href: `#${SECTION_IDS.muscleMap}` },
    ],
  },
  {
    title: 'MOVIVO',
    links: [
      { label: 'Manifesto', href: `#${SECTION_IDS.manifesto}` },
      { label: 'Um dia com a MOVIVO', href: `#${SECTION_IDS.day}` },
      { label: 'MOVIVO Club', href: `#${SECTION_IDS.club}` },
    ],
  },
] as const;

export const SOCIAL = {
  instagram: { handle: '@movivo.br', url: 'https://www.instagram.com/movivo.br/' },
} as const;

/**
 * Links institucionais. `null` = página ainda não publicada: o rodapé omite o link em vez
 * de apontar para um 404. Preencha com a rota/URL quando o documento for aprovado.
 */
export const LEGAL_LINKS: { terms: string | null; privacy: string | null } = {
  terms: null,
  privacy: null,
};

/** Canal de contato público. Direct do Instagram oficial até existir e-mail/WhatsApp público. */
export const CONTACT_URL: string | null = 'https://ig.me/m/movivo.br';

export interface Credential {
  /** Área (ex.: "Educação Física"). */
  area: string;
  /** Grau e situação (ex.: "Bacharelado", "Graduação em andamento"). */
  degree: string;
  /** Em andamento: exibido como tal, nunca como título concluído. */
  inProgress?: boolean;
}

export interface ResponsibleProfessional {
  /** Nome curto do card. */
  name: string;
  /** Nome completo da página de formação. */
  fullName: string;
  role: string;
  /** Posição na empresa, na página de formação. */
  position: string;
  profession: string;
  /** Número do registro (ex.: `'000000-G/SP'`). `null` → exibe "Regulamentado pelo CREF". */
  crefNumber: string | null;
  summary: string;
  tagline: string;
  bio: string;
  education: readonly Credential[];
  specialization: readonly Credential[];
  practice: { years: string; label: string; text: string };
  sport: readonly string[];
  teaching: string;
  motto: string;
  pillars: readonly string[];
  pillarsNote: string;
}

/**
 * Responsável Técnico. Formações em andamento aparecem como "em andamento": ele NÃO é
 * apresentado como médico ou nutricionista (sem CRM/CRN), nem a MOVIVO como tendo um.
 */
export const RESPONSIBLE_PROFESSIONAL: ResponsibleProfessional = {
  name: 'Leonardo',
  fullName: 'Leonardo Rodrigues Brito',
  role: 'Responsável técnico',
  position: 'Sócio e responsável técnico',
  profession: 'Profissional de Educação Física',
  crefNumber: null,
  summary: 'Responsável pela metodologia de treinamento baseada em ciência da MOVIVO.',
  tagline: 'Ciência, prática e experiência aplicadas à saúde e à performance.',
  bio: 'Atuação multidisciplinar em saúde, educação e performance humana, unindo formação acadêmica, experiência como professor e mais de 15 anos de treino na prática.',
  education: [
    { area: 'Educação Física', degree: 'Bacharelado' },
    { area: 'Enfermagem', degree: 'Bacharelado' },
    { area: 'Medicina', degree: 'Graduação em andamento', inProgress: true },
    { area: 'Nutrição', degree: 'Graduação em andamento', inProgress: true },
  ],
  specialization: [
    { area: 'Fisiologia do Exercício', degree: 'Pós-graduação' },
    { area: 'Nutrição Esportiva', degree: 'Pós-graduação' },
    {
      area: 'Fisiologia e Fisiopatologia',
      degree: 'Pós-graduação em andamento · UNIFESP',
      inProgress: true,
    },
    { area: 'Urgência e emergência', degree: 'Formação e experiência' },
  ],
  practice: {
    years: '15+',
    label: 'anos de musculação',
    text: 'Mantém uma rotina estruturada de treino e usa a própria prática como extensão do estudo de fisiologia, treinamento e performance: o exercício entendido não só nos livros, mas no treino, na preparação, na recuperação e na experiência real de quem treina.',
  },
  sport: [
    'Maratona',
    'Meia maratona',
    'Corrida de rua',
    'Fisiculturismo amador',
    'Judô',
    'Futebol amador',
  ],
  teaching:
    'Professor no ensino superior e na educação profissional, participou da formação de milhares de alunos e profissionais, principalmente em saúde, treinamento e atendimento de urgência e emergência.',
  motto: 'Conhecimento é poder e salva vidas.',
  pillars: ['Ciência', 'Experiência', 'Prática', 'Aplicabilidade'],
  pillarsNote:
    'Conhecimento só ganha valor quando pode ser aplicado: entender não só o que fazer, mas por que, quando e como fazer.',
};

export function crefLabel(professional: ResponsibleProfessional): string {
  return professional.crefNumber ? `CREF ${professional.crefNumber}` : 'Regulamentado pelo CREF';
}
