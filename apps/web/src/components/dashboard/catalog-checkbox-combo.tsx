'use client';

export interface CatalogCheckboxOption<T extends string = string> {
  value: T;
  label: string;
}

/**
 * Combo de checkboxes de múltipla escolha dos formulários de exercício — "Músculo" e
 * "Nível" no modal da tela Exercícios (`ExerciseEditorDialog`) e no "Adicionar exercício ao
 * catálogo" da fila de substituição (`SubstitutionCatalogGapDialog`). Um único markup para
 * os campos não divergirem entre si.
 *
 * `<details>/<summary>` em vez de um combo Radix: o projeto só tem `@radix-ui/react-select`,
 * que é single-value. `<fieldset>/<legend>` dá ao grupo de checkboxes um nome acessível
 * ("Músculo", "Nível"); o `<summary>` mostra o que está marcado, ou o `placeholder`.
 *
 * Marcar ACRESCENTA ao fim e desmarcar remove só aquele valor — valores fora de `options`
 * (ex.: um músculo em texto livre cadastrado antes da lista fechada) são preservados. Quem
 * precisa de ordem canônica (Nível) ordena no `onChange`.
 */
export function CatalogCheckboxCombo<T extends string>({
  legend,
  placeholder,
  options,
  selected,
  onChange,
}: {
  legend: string;
  /** Texto do resumo quando nada está marcado (ex.: "Selecione o(s) músculo(s)"). */
  placeholder: string;
  options: readonly CatalogCheckboxOption<T>[];
  selected: readonly T[];
  onChange: (next: T[]) => void;
}) {
  const summary =
    selected.length > 0
      ? selected
          .map((value) => options.find((option) => option.value === value)?.label ?? value)
          .join(', ')
      : placeholder;

  return (
    <fieldset className="text-label font-semibold">
      <legend>{legend}</legend>
      <details className="group mt-1 rounded-lg border border-border bg-card">
        <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-body font-normal marker:content-none">
          <span className="truncate text-muted-foreground group-open:text-foreground">
            {summary}
          </span>
          <span aria-hidden="true" className="ml-2 text-muted-foreground">
            ▾
          </span>
        </summary>
        <div className="grid gap-1 border-t border-border p-2">
          {options.map((option) => {
            const checked = selected.includes(option.value);
            return (
              <label
                key={option.value}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-label hover:bg-secondary"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    onChange(
                      checked
                        ? selected.filter((value) => value !== option.value)
                        : [...selected, option.value],
                    )
                  }
                />
                {option.label}
              </label>
            );
          })}
        </div>
      </details>
    </fieldset>
  );
}
