import * as path from 'path';
import { normalizarTelefone } from '../imoveis/dado-cliente.controller';

/**
 * Configuração da marcação de leads de retorno, lida das variáveis de ambiente.
 * Qualquer problema de configuração deixa o módulo DESLIGADO: na dúvida, ele
 * não lê nem grava nada no CRM.
 */

export type Modo = 'desligado' | 'simulacao' | 'teste' | 'ativo';
const MODOS: readonly string[] = ['desligado', 'simulacao', 'teste', 'ativo'];

/** Locação - Beta, Venda - Terceiros, Venda - Lançamentos e Pré Vendas SDR. */
export const FUNIS_PADRAO = [
  '66eaadbee736e20026d75b62',
  '65024237f7a7d8000d3065ad',
  '66670e271d7b460012926d40',
  '651eecde2b5b67000d833026',
];
export const FUNIL_TESTES_PADRAO = '6a723eee480c33002099c27d';
/** Campo de negociação "Tipo de entrada", criado no RD CRM em 16/10/2026. */
export const CAMPO_TIPO_ENTRADA_PADRAO = '6ad21923aa78e90029fa490b';
/** WhatsApp de Locação, WhatsApp de Vendas, telefone fixo e domínio da Sassi. */
export const CONTATOS_INTERNOS_PADRAO =
  '(19) 99368-1809,(19) 99368-1824,(19) 3404-4499,@sassiimoveis.com.br';

export interface ConfigMarcacao {
  modo: Modo;
  /** Token do usuário do CRM. Nunca vai para log nem para resposta de rota. */
  token: string;
  intervaloMinutos: number;
  /** Tempo de espera depois da criação, para a roleta escolher o responsável. */
  esperaMinutos: number;
  funisPermitidos: string[];
  funilTestes: string;
  campoTipoEntrada: string;
  /** Telefones internos no formato 55DDNUMERO. */
  telefonesInternos: string[];
  /** Domínios internos, com @, em minúsculas. */
  dominiosInternos: string[];
  /** E-mails de teste, em minúsculas. Valem mais que o bloqueio de internos. */
  emailsTeste: string[];
  /** Reenvia os demais campos personalizados junto com o "Tipo de entrada". */
  reenviarCampos: boolean;
  arquivoRegistro: string;
  problemas: string[];
}

const ID_CRM = /^[0-9a-f]{24}$/i;

function lista(valor: string | undefined): string[] | null {
  if (valor === undefined || !valor.trim()) return null;
  return valor
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function numero(
  valor: string | undefined,
  padrao: number,
  minimo: number,
  maximo: number,
  nome: string,
  problemas: string[],
): number {
  if (valor === undefined || !valor.trim()) return padrao;
  const n = Number(valor.trim());
  if (!Number.isFinite(n) || n < minimo || n > maximo) {
    problemas.push(`${nome} deve ser um número entre ${minimo} e ${maximo}`);
    return padrao;
  }
  return n;
}

export function lerConfig(env: Record<string, string | undefined>): ConfigMarcacao {
  const problemas: string[] = [];

  const modoBruto = (env.MARCACAO_MODO || 'desligado').trim().toLowerCase();
  let modo: Modo = 'desligado';
  if (MODOS.includes(modoBruto)) modo = modoBruto as Modo;
  else problemas.push('MARCACAO_MODO deve ser desligado, simulacao, teste ou ativo');

  // Variável só da marcação: ligar a marcação não reativa o /registrar-lead,
  // que usa RDCRM_TOKEN (decisão 7 do planejamento)
  const token = (env.MARCACAO_RDCRM_TOKEN || '').trim();

  const intervaloMinutos = numero(env.INTERVALO_MINUTOS, 5, 2, 60, 'INTERVALO_MINUTOS', problemas);
  const esperaMinutos = numero(env.ESPERA_TAREFA_MINUTOS, 10, 0, 240, 'ESPERA_TAREFA_MINUTOS', problemas);

  const funisPermitidos = lista(env.FUNIS_PERMITIDOS) || [...FUNIS_PADRAO];
  const funilTestes = (env.FUNIL_TESTES_ID || FUNIL_TESTES_PADRAO).trim();
  const campoTipoEntrada = (env.CAMPO_TIPO_ENTRADA_ID || CAMPO_TIPO_ENTRADA_PADRAO).trim();

  const internos = lista(env.CONTATOS_INTERNOS) || lista(CONTATOS_INTERNOS_PADRAO) || [];
  const dominiosInternos = internos
    .filter((x) => x.startsWith('@'))
    .map((x) => x.toLowerCase());
  const telefonesInternos = internos
    .filter((x) => !x.startsWith('@'))
    .map((x) => normalizarTelefone(x))
    .filter((x): x is string => Boolean(x));

  const emailsTeste = (lista(env.EMAILS_TESTE) || []).map((e) => e.toLowerCase());
  const reenviarCampos = /^(sim|true|1)$/i.test((env.MARCACAO_REENVIAR_CAMPOS || '').trim());
  const arquivoRegistro = path.join(env.CACHE_DIR || '/tmp', 'marcacao-registro.json');

  if (modo !== 'desligado' && !token) {
    problemas.push('falta o token do CRM (MARCACAO_RDCRM_TOKEN)');
  }
  if (token && /\s/.test(token)) problemas.push('o token do CRM tem espaços');
  if (!ID_CRM.test(campoTipoEntrada)) problemas.push('CAMPO_TIPO_ENTRADA_ID inválido');
  if (!ID_CRM.test(funilTestes)) problemas.push('FUNIL_TESTES_ID inválido');
  if (!funisPermitidos.length || funisPermitidos.some((f) => !ID_CRM.test(f))) {
    problemas.push('FUNIS_PERMITIDOS deve ter IDs de funil separados por vírgula');
  }
  if (funisPermitidos.includes(funilTestes)) {
    problemas.push('o Funil de Testes não pode estar em FUNIS_PERMITIDOS');
  }
  if (modo === 'teste' && emailsTeste.length === 0) {
    problemas.push('o modo teste precisa de EMAILS_TESTE');
  }

  // Configuração com problema: o módulo não roda
  if (problemas.length) modo = 'desligado';

  return {
    modo,
    token,
    intervaloMinutos,
    esperaMinutos,
    funisPermitidos,
    funilTestes,
    campoTipoEntrada,
    telefonesInternos,
    dominiosInternos,
    emailsTeste,
    reenviarCampos,
    arquivoRegistro,
    problemas,
  };
}
