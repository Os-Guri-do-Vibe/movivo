import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WhatsappText } from './whatsapp-text';

const html = (text: string) =>
  render(<div>{<WhatsappText text={text} />}</div>).container.innerHTML;
const root = (text: string) => render(<WhatsappText text={text} />).container;

describe('WhatsappText — formatação do WhatsApp', () => {
  it('negrito, itálico, riscado e mono', () => {
    const c = root('*forte* _inclinado_ ~riscado~ `código`');
    expect(c.querySelector('strong')?.textContent).toBe('forte');
    expect(c.querySelector('em')?.textContent).toBe('inclinado');
    expect(c.querySelector('s')?.textContent).toBe('riscado');
    expect(c.querySelector('code')?.textContent).toBe('código');
  });

  it('formatações aninhadas', () => {
    const c = root('*_negrito e itálico_* e _*ao contrário*_');
    expect(c.querySelectorAll('strong em, em strong')).toHaveLength(2);
  });

  it('marcador no meio da palavra não formata (snake_case, 2*3*4)', () => {
    const c = root('use snake_case_nome e 2*3*4');
    expect(c.querySelector('em')).toBeNull();
    expect(c.querySelector('strong')).toBeNull();
    expect(c.textContent).toBe('use snake_case_nome e 2*3*4');
  });

  it('exige texto colado nos marcadores: espaço por dentro ou marcador sem par ficam como estão', () => {
    for (const text of ['veja * não é negrito *', '*sem fechar', '**', '_ _', 'a * b * c']) {
      const c = root(text);
      expect(c.querySelector('strong,em,s,code')).toBeNull();
      expect(c.textContent).toBe(text);
    }
  });

  it('formatação não atravessa a quebra de linha', () => {
    const c = root('*linha 1\nlinha 2*');
    expect(c.querySelector('strong')).toBeNull();
    expect(c.textContent).toBe('*linha 1\nlinha 2*');
  });

  it('mono não interpreta o que está dentro', () => {
    const c = root('`*não é negrito*`');
    expect(c.querySelector('code')?.textContent).toBe('*não é negrito*');
    expect(c.querySelector('strong')).toBeNull();
  });

  it('bloco de código com crases triplas preserva linhas e marcadores', () => {
    const c = root('antes\n```\nlinha *1*\n  linha 2\n```\ndepois');
    expect(c.querySelector('pre')?.textContent).toBe('linha *1*\n  linha 2');
    expect(c.querySelector('pre strong')).toBeNull();
    expect(c.textContent).toContain('antes');
    expect(c.textContent).toContain('depois');
  });

  it('listas com marcador e numeradas, com formatação nos itens', () => {
    const c = root('- *agachamento* 3x10\n* supino\n\n1. aquecer\n2. treinar');
    expect(c.querySelectorAll('ul > li')).toHaveLength(2);
    expect(c.querySelector('ul li strong')?.textContent).toBe('agachamento');
    expect(c.querySelectorAll('ol > li')).toHaveLength(2);
  });

  it('citação', () => {
    const c = root('> dica do dia\n> beba água\nresposta');
    expect(c.querySelector('blockquote')?.textContent).toBe('dica do dia\nbeba água');
    expect(c.textContent).toContain('resposta');
  });

  it('links http/https viram âncora segura; pontuação final fica fora do link', () => {
    const a = root('veja https://movivo.com.br/treino?x=1_2, ok').querySelector('a');
    expect(a).toHaveAttribute('href', 'https://movivo.com.br/treino?x=1_2');
    expect(a).toHaveAttribute('target', '_blank');
    expect(a).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('underscores dentro do link não viram itálico', () => {
    const c = root('_veja_ http://a.com/a_b_c');
    expect(c.querySelectorAll('em')).toHaveLength(1);
    expect(c.querySelector('a')?.textContent).toBe('http://a.com/a_b_c');
  });

  it('segurança: HTML e javascript: do aluno aparecem como texto, nunca como marcação', () => {
    const c = root(
      '<img src=x onerror=alert(1)> <script>x</script> javascript:alert(1) [x](javascript:alert(1))',
    );
    expect(c.querySelector('img,script')).toBeNull();
    expect(c.querySelector('a')).toBeNull();
    expect(c.textContent).toContain('<script>x</script>');
  });

  it('texto comum preserva quebras de linha e linhas em branco', () => {
    expect(root('a\n\nb').querySelector('p')?.textContent).toBe('a\n\nb');
    expect(html('')).toBe('<div></div>');
  });
});
