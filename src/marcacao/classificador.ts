/**
 * Regra da marcação (decisões 3 e 4 do planejamento):
 * - outra negociação ABERTA, anterior, num funil permitido -> Possível duplicado
 * - senão, qualquer outra negociação anterior                -> Retorno
 * - nenhuma negociação anterior                              -> Novo
 * Só valem negociações criadas ANTES da nova; as posteriores serão comparadas
 * com esta quando chegar a vez delas.
 */

export type TipoEntrada = 'Novo' | 'Retorno' | 'Possível duplicado';
export const TIPOS_ENTRADA: readonly TipoEntrada[] = ['Novo', 'Retorno', 'Possível duplicado'];

export interface NegociacaoResumo {
  id: string;
  criadaEm: string | null;
  aberta: boolean;
  pausada: boolean;
  ganhou: boolean | null;
  fechadaEm: string | null;
  motivoPerda: string | null;
  funilId: string | null;
  funilNome: string | null;
  etapaNome: string | null;
  responsavelId: string | null;
  responsavelNome: string | null;
  atualizadaEm: string | null;
  /** true quando os dados vieram de GET /deals/{id} (funil, responsável etc.). */
  detalhada: boolean;
}

export interface Classificacao {
  tipo: TipoEntrada;
  /** Negociações anteriores, da mais recente para a mais antiga. */
  anteriores: NegociacaoResumo[];
  /** Anteriores ainda abertas num funil permitido. */
  abertasPermitidas: NegociacaoResumo[];
}

export function classificar(
  nova: { id: string; criadaEm: string },
  relacionadas: NegociacaoResumo[],
  funisPermitidos: ReadonlySet<string>,
): Classificacao {
  const tNova = Date.parse(nova.criadaEm);
  const vistas = new Set<string>();
  const anteriores: NegociacaoResumo[] = [];

  for (const r of relacionadas) {
    if (!r.id || r.id === nova.id || vistas.has(r.id)) continue;
    vistas.add(r.id);
    const t = r.criadaEm ? Date.parse(r.criadaEm) : NaN;
    if (Number.isFinite(t) && Number.isFinite(tNova) && t < tNova) anteriores.push(r);
  }
  anteriores.sort((a, b) => Date.parse(b.criadaEm as string) - Date.parse(a.criadaEm as string));

  const abertasPermitidas = anteriores.filter(
    (r) => r.aberta && r.funilId !== null && funisPermitidos.has(r.funilId),
  );

  const tipo: TipoEntrada = abertasPermitidas.length
    ? 'Possível duplicado'
    : anteriores.length
      ? 'Retorno'
      : 'Novo';

  return { tipo, anteriores, abertasPermitidas };
}
