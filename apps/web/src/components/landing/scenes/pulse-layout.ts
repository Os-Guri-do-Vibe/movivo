/**
 * Os quatro núcleos do sistema em coordenadas normalizadas de tela (NDC, -1..1).
 * Fonte única para a cena WebGL (projeta no espaço 3D), para os rótulos HTML e para o
 * fallback estático — os três sempre coincidem, em qualquer proporção de palco.
 */
export const PULSE_NUCLEI = [
  { label: 'Físico', x: -0.58, y: 0.56 },
  { label: 'Mental', x: 0.58, y: 0.56 },
  { label: 'Rotina', x: -0.58, y: -0.56 },
  { label: 'Performance', x: 0.58, y: -0.56 },
] as const;
