import { NegociacaoResumo } from './classificador';
import { dataBR, dataHoraBR } from './tempo';

/** Assuntos aprovados na decisão 4 do planejamento. */
export const ASSUNTO_RETORNO = 'Lead de retorno';
export const ASSUNTO_DUPLICADO = 'Possível duplicado: conferir antes de perder';

const RODAPE = 'Tarefa criada automaticamente pela marcação de leads de retorno.';
const MAXIMO_NA_LISTA = 5;

function situacao(n: NegociacaoResumo): string {
  if (n.aberta) {
    const etapa = n.etapaNome ? `, etapa ${n.etapaNome}` : '';
    return n.pausada ? `pausada${etapa}` : `em andamento${etapa}`;
  }
  if (n.ganhou === true) return `ganha em ${dataBR(n.fechadaEm)}`;
  const motivo = n.motivoPerda ? ` (motivo: ${n.motivoPerda})` : '';
  return `perdida em ${dataBR(n.fechadaEm)}${motivo}`;
}

function linhaAnterior(n: NegociacaoResumo): string {
  const funil = n.funilNome || 'funil não informado';
  const responsavel = n.responsavelNome || 'sem responsável';
  return `- ${funil}, criada em ${dataBR(n.criadaEm)}: ${situacao(n)}. Responsável: ${responsavel}.`;
}

function campanha(campanhaAtual: string | null): string {
  return `Campanha atual: ${campanhaAtual && campanhaAtual.trim() ? campanhaAtual.trim() : 'ainda não informada'}`;
}

function listaLimitada(itens: NegociacaoResumo[], linha: (n: NegociacaoResumo) => string): string[] {
  const linhas = itens.slice(0, MAXIMO_NA_LISTA).map(linha);
  const resto = itens.length - MAXIMO_NA_LISTA;
  if (resto > 0) linhas.push(`- e mais ${resto} ${resto === 1 ? 'negociação anterior' : 'negociações anteriores'}.`);
  return linhas;
}

/** Texto da tarefa de retorno: histórico do lead + Campanha atual (decisão 2). */
export function textoRetorno(anteriores: NegociacaoResumo[], campanhaAtual: string | null): string {
  return [
    'Este lead já teve negociação na Sassi. Retorno não é duplicado: siga com o atendimento.',
    '',
    'Negociações anteriores (da mais recente para a mais antiga):',
    ...listaLimitada(anteriores, linhaAnterior),
    '',
    campanha(campanhaAtual),
    '',
    RODAPE,
  ].join('\n');
}

/** Texto da tarefa de possível duplicado: a outra negociação aberta e quem a atende. */
export function textoDuplicado(abertas: NegociacaoResumo[], campanhaAtual: string | null): string {
  const linhaAberta = (n: NegociacaoResumo) => {
    const funil = n.funilNome || 'funil não informado';
    const etapa = n.etapaNome || 'etapa não informada';
    const responsavel = n.responsavelNome || 'sem responsável';
    return `- ${funil}, etapa ${etapa}. Responsável: ${responsavel}. Última atualização: ${dataHoraBR(n.atualizadaEm)}.`;
  };
  return [
    'Este lead tem outra negociação aberta. Confiram entre vocês antes de marcar perda.',
    '',
    abertas.length === 1 ? 'Negociação aberta:' : 'Negociações abertas:',
    ...listaLimitada(abertas, linhaAberta),
    '',
    campanha(campanhaAtual),
    '',
    RODAPE,
  ].join('\n');
}
