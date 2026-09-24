import { MovivoLogo } from '../ui/movivo-logo';

import styles from './preloader.module.css';

/**
 * Preloader honesto: só aparece enquanto as fontes críticas do hero ainda não estão
 * disponíveis. O script inline roda antes da primeira pintura do restante da página e:
 *  - não mostra nada com `prefers-reduced-motion`, em visita repetida na mesma sessão
 *    ou quando a fonte já está carregada (cache);
 *  - some assim que as fontes carregam — sem duração mínima artificial;
 *  - tem teto de 2,4s: nunca segura a página por falha de rede.
 * Sem JS o elemento permanece oculto (`display: none` por padrão).
 */
const PRELOADER_SCRIPT = `(function(){try{
var el=document.getElementById('mv-preloader');if(!el||!document.fonts)return;
if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
if(sessionStorage.getItem('mv-intro'))return;
var cs=getComputedStyle(el);
var display=(cs.getPropertyValue('--font-cabinet').split(',')[0]||'').trim();
var body=(cs.getPropertyValue('--font-satoshi').split(',')[0]||'').trim();
if(!display||!body)return;
var specs=['800 1em '+display,'400 1em '+body];
if(specs.every(function(s){return document.fonts.check(s);}))return;
el.setAttribute('data-state','active');
var done=false;
function finish(){if(done)return;done=true;
try{sessionStorage.setItem('mv-intro','1');}catch(e){}
el.setAttribute('data-state','exit');
setTimeout(function(){el.setAttribute('data-state','done');},650);}
setTimeout(finish,2400);
Promise.all(specs.map(function(s){return document.fonts.load(s);})).then(finish,finish);
}catch(e){}})();`;

export function Preloader() {
  return (
    <>
      <div
        id="mv-preloader"
        className={styles.preloader}
        aria-hidden="true"
        suppressHydrationWarning
      >
        <div className={styles.stage}>
          <span className={styles.core} />
          {[0, 1, 2, 3, 4].map((index) => (
            <span key={index} className={styles.particle} data-index={index} />
          ))}
          <MovivoLogo className={styles.logo} title={null} />
          <span className={styles.caption} lang="en">
            movement loading
          </span>
        </div>
      </div>
      {/* Precisa rodar sincronamente durante o parse, antes do resto do HTML pintar. */}
      <script dangerouslySetInnerHTML={{ __html: PRELOADER_SCRIPT }} />
    </>
  );
}
