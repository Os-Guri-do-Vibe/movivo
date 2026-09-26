import AcidSquares from './acid-squares';

/**
 * Fundo animado de `/entrar`. Fixo na viewport, atrás do cartão de login — decorativo
 * (`aria-hidden`), então nunca compete com o formulário na ordem de leitura/foco.
 */
export function LoginBackground() {
  return (
    <div aria-hidden="true" className="fixed inset-0 -z-10">
      <AcidSquares
        color1="#06302A"
        color2="#25E27E"
        color3="#06302A"
        detail="medium"
        speed={0.7}
        waveDepth={1}
        zoom={1.3}
        density={10}
        glow={1}
        exposure={2700}
        spread={0.3}
        stepSize={0.002}
        colorShift={0}
        contrast={1}
        brightness={1}
        opacity={1}
        mouseInteraction
        mouseStrength={0.1}
        mouseRadius={0.35}
        blur={0}
        grain
        grainIntensity={0.05}
      />
    </div>
  );
}
