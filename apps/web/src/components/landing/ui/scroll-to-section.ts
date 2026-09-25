/**
 * Navegação entre seções da landing sem `#hash` na URL.
 *
 * A âncora nativa grava o hash (URL poluída, F5 volta para a seção em vez do hero) e
 * cria uma entrada de histórico sem o estado interno do App Router — o `popstate`
 * dessas entradas é ignorado pelo Next, e "voltar" da anamnese trocava a URL sem
 * trocar a tela. Rolar via script mantém a URL limpa e o histórico só com rotas.
 *
 * O foco vai para a seção (como na navegação por âncora), para leitor de tela e
 * teclado continuarem dali. Retorna `false` quando o destino não existe na página.
 */
export function scrollToSection(id: string): boolean {
  const target = document.getElementById(id);
  if (!target) return false;
  target.scrollIntoView({ block: 'start' });
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
  return true;
}
