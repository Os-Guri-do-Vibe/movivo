/**
 * Contrato entre o cliente da anamnese e o BFF (`app/api/anamnesis`).
 *
 * O token da sessão fica num cookie httpOnly que é do navegador inteiro, não da aba.
 * Cada aba guarda só a *referência* da sessão que abriu (hash truncado do token — não
 * serve como credencial) e a manda em toda escrita. Se outra aba abriu um cadastro
 * novo, o cookie mudou e o BFF recusa, em vez de gravar respostas de saúde e
 * consentimentos no cadastro errado.
 */
export const ANAMNESIS_REF_HEADER = 'x-anamnesis-ref';

/** Resposta do BFF quando a referência da aba não é mais a sessão do cookie. */
export const SESSION_REPLACED_STATUS = 412;
