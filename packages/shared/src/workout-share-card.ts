import { shareCardMuscleSchema, type ShareCardMuscle } from './schemas/workout-share-card.schema';

const MUSCLES: ReadonlyArray<{
  label: string;
  groups: ShareCardMuscle[];
  aliases: string[];
}> = [
  {
    label: 'Corpo inteiro',
    groups: [...shareCardMuscleSchema.options],
    aliases: ['corpo todo', 'corpo inteiro', 'full body', 'full_body'],
  },
  { label: 'Peito', groups: ['chest'], aliases: ['peito', 'peitoral', 'peitorais', 'chest'] },
  {
    label: 'Ombros',
    groups: ['shoulders'],
    aliases: ['ombro', 'ombros', 'deltoide', 'deltoides', 'shoulders'],
  },
  { label: 'Bíceps', groups: ['biceps'], aliases: ['biceps'] },
  { label: 'Tríceps', groups: ['triceps'], aliases: ['triceps'] },
  { label: 'Antebraços', groups: ['forearms'], aliases: ['antebraco', 'antebracos', 'forearms'] },
  { label: 'Abdômen', groups: ['abs'], aliases: ['abdomen', 'abdominal', 'abdominais', 'abs'] },
  { label: 'Oblíquos', groups: ['obliques'], aliases: ['obliquo', 'obliquos', 'obliques'] },
  { label: 'Costas', groups: ['upper_back', 'lats'], aliases: ['costas'] },
  { label: 'Trapézio', groups: ['upper_back'], aliases: ['trapezio', 'trapezios', 'upper_back'] },
  { label: 'Dorsais', groups: ['lats'], aliases: ['dorsal', 'dorsais', 'latissimo', 'lats'] },
  { label: 'Lombar', groups: ['lower_back'], aliases: ['lombar', 'lombares', 'lower_back'] },
  { label: 'Core', groups: ['abs', 'obliques'], aliases: ['core'] },
  { label: 'Glúteos', groups: ['glutes'], aliases: ['gluteo', 'gluteos', 'glutes'] },
  { label: 'Quadríceps', groups: ['quads'], aliases: ['quadriceps', 'quads'] },
  {
    label: 'Posteriores de coxa',
    groups: ['hamstrings'],
    aliases: ['posterior de coxa', 'posteriores de coxa', 'isquiotibiais', 'hamstrings'],
  },
  { label: 'Panturrilhas', groups: ['calves'], aliases: ['panturrilha', 'panturrilhas', 'calves'] },
];

const FULL_BODY_LABEL = 'Corpo inteiro';

/**
 * Texto e máscaras saem da mesma classificação; nunca inferimos músculos pelo nome do exercício.
 *
 * "Corpo todo" (burpee, farmer's walk, clean com kettlebell…) é a ausência de um músculo
 * específico, não a soma de todos: num Push com um burpee no fim, expandi-lo pintaria o corpo
 * inteiro e esconderia o que o aluno de fato treinou. Por isso só vale quando o treino não tem
 * nenhum músculo específico.
 */
export function mapWorkoutMuscles(raw: readonly string[]): {
  trainedMuscles: string[];
  muscleGroupsForHighlighter: ShareCardMuscle[];
} {
  const labels = new Map<string, string>();
  const groups = new Set<ShareCardMuscle>();
  let fullBody: (typeof MUSCLES)[number] | undefined;
  for (const value of raw) {
    const name = value.trim();
    const key = name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    if (!key) continue;
    const muscle = MUSCLES.find((item) => item.aliases.includes(key));
    if (muscle?.label === FULL_BODY_LABEL) {
      fullBody = muscle;
      continue;
    }
    const label = muscle?.label ?? name.charAt(0).toUpperCase() + name.slice(1);
    labels.set(label.toLowerCase(), label);
    for (const group of muscle?.groups ?? []) groups.add(group);
    // ponytail: regiões sem máscara (ex.: pescoço) continuam na lista, sem pintar outra
    // região por aproximação. Novas máscaras entram aqui quando a biblioteca as oferecer.
  }
  if (fullBody && labels.size === 0) {
    labels.set(fullBody.label.toLowerCase(), fullBody.label);
    for (const group of fullBody.groups) groups.add(group);
  }
  return { trainedMuscles: [...labels.values()], muscleGroupsForHighlighter: [...groups] };
}

/**
 * Rótulo de duração do card: o tempo exato do cronômetro do treino, sem arredondar
 * ("01:30:23"). Único formatador: a API desenha o PNG com ele.
 */
export function formatShareCardDuration(durationSeconds: number): string {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) return '—';
  const total = Math.floor(durationSeconds);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}
