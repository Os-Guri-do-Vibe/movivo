/**
 * Página de demonstração do diário (cenários simulados, sem aluno). Só existe no ambiente local:
 * a variável é ligada no `docker-compose.yml` e não existe na VPS.
 */
export function studentDemoEnabled(): boolean {
  return process.env.STUDENT_DEMO_ENABLED === 'true';
}
