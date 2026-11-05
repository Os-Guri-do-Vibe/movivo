import type { PlannedMeal } from '@movivo/shared';

import { brl, OPTION_LETTERS, optionSummary, quantityLabel } from '@/lib/meal-menu';

/**
 * Cardápio de uma refeição: opções A, B e C com a quantidade de cada alimento e as trocas
 * equivalentes. Plano antigo (sem cardápio) mostra só as combinações de exemplo.
 */
export function MealMenu({ meal }: { meal: PlannedMeal }) {
  if (!meal.options || meal.options.length === 0) {
    return (
      <ul className="mt-1 list-disc pl-5 text-body">
        {meal.examples.map((example) => (
          <li key={example}>{example}</li>
        ))}
      </ul>
    );
  }
  return (
    <div className="mt-3 flex flex-col gap-2">
      {meal.options.map((option, index) => (
        <details
          key={option.title}
          open={index === 0}
          className="rounded-lg border border-border bg-card"
        >
          <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2.5">
            <span className="font-semibold">
              Opção {OPTION_LETTERS[index] ?? index + 1} · {option.title}
            </span>
            <span className="text-label text-muted-foreground">{optionSummary(option)}</span>
          </summary>
          <ul className="divide-y divide-border border-t border-border">
            {option.items.map((item) => (
              <li key={item.foodId} className="px-3 py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-body">{item.name}</span>
                  <span className="shrink-0 text-body font-semibold">{quantityLabel(item)}</span>
                </div>
                {item.swaps.length > 0 ? (
                  <p className="mt-0.5 text-label text-muted-foreground">
                    Ou troque por:{' '}
                    {item.swaps.map((s) => `${quantityLabel(s)} de ${s.name}`).join(' · ')}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="border-t border-border px-3 py-2 text-label text-muted-foreground">
            Custo estimado da opção: ~{brl(option.estimatedCostBrl)}
          </p>
        </details>
      ))}
    </div>
  );
}
