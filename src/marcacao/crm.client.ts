import { paraFiltroCrm } from './tempo';

/**
 * Cliente da API v1 do RD Station CRM usado pela marcação.
 * - O token vai só na URL da chamada; mensagens de erro levam só método,
 *   caminho e status HTTP (nem o token, nem o corpo da resposta).
 * - Intervalo mínimo entre chamadas (padrão 600 ms = até 100 por minuto; o
 *   limite do CRM é 120), compartilhado por tudo que usa o mesmo cliente.
 * - GET: em erro 429 espera o Retry-After (no máximo 2 min) e repete; em
 *   falha de rede, erro 5xx ou resposta vazia, repete até 3 vezes.
 * - PUT e POST nunca repetem: com erro, a negociação é tentada de novo na
 *   próxima rodada, que relê tudo antes de gravar.
 * - Resposta sem a lista esperada é tratada como erro, nunca como lista vazia.
 */

export interface ContatoCrm {
  id?: string;
  _id?: string;
  phones?: { phone?: string | null }[] | null;
  emails?: { email?: string | null }[] | null;
  deals?: NegociacaoDoContato[] | null;
}

export interface NegociacaoDoContato {
  id?: string;
  _id?: string;
  closed_at?: string | null;
  win?: boolean | null;
  deal_lost_reason_id?: string | null;
}

export interface CampoPersonalizadoCrm {
  custom_field_id?: string;
  custom_field?: { id?: string; _id?: string } | null;
  value?: unknown;
}

export interface ReferenciaCrm {
  id?: string;
  _id?: string;
  name?: string;
}

export interface NegociacaoCrm {
  id?: string;
  _id?: string;
  created_at?: string;
  updated_at?: string;
  closed_at?: string | null;
  win?: boolean | null;
  hold?: boolean | null;
  deal_stage?: (ReferenciaCrm & { deal_pipeline_id?: string }) | null;
  deal_pipeline?: ReferenciaCrm | null;
  user?: ReferenciaCrm | null;
  campaign?: ReferenciaCrm | null;
  deal_lost_reason_id?: string | null;
  deal_lost_reason?: ReferenciaCrm | null;
  deal_custom_fields?: CampoPersonalizadoCrm[] | null;
  contacts?: ContatoCrm[] | null;
}

export interface FunilCrm extends ReferenciaCrm {
  deal_stages?: ReferenciaCrm[] | null;
}

export interface TarefaCrm {
  id?: string;
  _id?: string;
  subject?: string;
  deal_id?: string;
  deal?: { id?: string; _id?: string } | null;
}

export interface NovaTarefa {
  deal_id: string;
  user_ids: string[];
  subject: string;
  type: 'task';
  date: string;
  hour: string;
  notes: string;
  done: false;
}

export interface CampoParaGravar {
  custom_field_id: string;
  value: unknown;
}

/** O que a marcação usa do CRM. Os testes trocam por um CRM falso. */
export interface ApiCrm {
  readonly chamadas: number;
  listarFunis(): Promise<FunilCrm[]>;
  listarMotivosPerda(): Promise<{ id: string; nome: string }[]>;
  listarNegociacoesCriadasEntre(inicio: Date, fim: Date, maximoPaginas?: number): Promise<NegociacaoCrm[]>;
  obterNegociacao(id: string): Promise<NegociacaoCrm>;
  contatosDaNegociacao(id: string): Promise<ContatoCrm[]>;
  buscarContatosPorTelefone(telefone: string): Promise<ContatoCrm[]>;
  buscarContatosPorEmail(email: string): Promise<ContatoCrm[]>;
  tarefasDaNegociacao(id: string): Promise<TarefaCrm[]>;
  atualizarCamposPersonalizados(id: string, campos: CampoParaGravar[]): Promise<void>;
  criarTarefa(tarefa: NovaTarefa): Promise<void>;
}

export class ErroCrm extends Error {
  constructor(
    mensagem: string,
    readonly status?: number,
  ) {
    super(mensagem);
    this.name = 'ErroCrm';
  }
}

export interface RespostaHttp {
  status: number;
  ok: boolean;
  headers: { get(nome: string): string | null };
  text(): Promise<string>;
}

export type Buscador = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<RespostaHttp>;

export interface OpcoesCliente {
  base?: string;
  intervaloMs?: number;
  timeoutMs?: number;
  buscador?: Buscador;
  dormir?: (ms: number) => Promise<void>;
}

const MAXIMO_PAGINAS = 5;
const MAXIMO_RETRY_AFTER_S = 120;

function listaDe<T>(resposta: unknown, chave: string, caminho: string): T[] {
  const valor = (resposta as Record<string, unknown> | null | undefined)?.[chave];
  if (!Array.isArray(valor)) throw new ErroCrm(`GET ${caminho}: resposta sem "${chave}"`);
  return valor as T[];
}

export class ClienteCrm implements ApiCrm {
  chamadas = 0;
  private proximaLiberada = 0;
  private fila: Promise<void> = Promise.resolve();

  constructor(
    private readonly token: string,
    private readonly opcoes: OpcoesCliente = {},
  ) {}

  async listarFunis(): Promise<FunilCrm[]> {
    const r = await this.chamar<unknown>('GET', '/deal_pipelines', { limit: '200' });
    if (Array.isArray(r)) return r as FunilCrm[];
    return listaDe<FunilCrm>(r, 'deal_pipelines', '/deal_pipelines');
  }

  async listarMotivosPerda(): Promise<{ id: string; nome: string }[]> {
    const r = await this.chamar<unknown>('GET', '/deal_lost_reasons', { limit: '200' });
    return listaDe<ReferenciaCrm>(r, 'deal_lost_reasons', '/deal_lost_reasons')
      .map((m) => ({ id: String(m._id ?? m.id ?? ''), nome: String(m.name ?? '') }))
      .filter((m) => m.id);
  }

  async listarNegociacoesCriadasEntre(inicio: Date, fim: Date, maximoPaginas = MAXIMO_PAGINAS): Promise<NegociacaoCrm[]> {
    const todas: NegociacaoCrm[] = [];
    for (let pagina = 1; pagina <= maximoPaginas; pagina++) {
      const r = await this.chamar<{ has_more?: boolean }>('GET', '/deals', {
        created_at_period: 'true',
        start_date: paraFiltroCrm(inicio),
        end_date: paraFiltroCrm(fim),
        limit: '200',
        page: String(pagina),
      });
      const deals = listaDe<NegociacaoCrm>(r, 'deals', '/deals');
      todas.push(...deals);
      if (!r?.has_more || deals.length === 0) break;
    }
    return todas;
  }

  async obterNegociacao(id: string): Promise<NegociacaoCrm> {
    const caminho = `/deals/${encodeURIComponent(id)}`;
    const r = await this.chamar<NegociacaoCrm>('GET', caminho);
    if (!r || typeof r !== 'object' || String(r.id ?? r._id ?? '') !== id) {
      throw new ErroCrm(`GET ${caminho}: resposta não é esta negociação`);
    }
    return r;
  }

  async contatosDaNegociacao(id: string): Promise<ContatoCrm[]> {
    const caminho = `/deals/${encodeURIComponent(id)}/contacts`;
    return listaDe<ContatoCrm>(await this.chamar<unknown>('GET', caminho, { limit: '50' }), 'contacts', caminho);
  }

  async buscarContatosPorTelefone(telefone: string): Promise<ContatoCrm[]> {
    return listaDe<ContatoCrm>(await this.chamar<unknown>('GET', '/contacts', { phone: telefone, limit: '200' }), 'contacts', '/contacts');
  }

  async buscarContatosPorEmail(email: string): Promise<ContatoCrm[]> {
    return listaDe<ContatoCrm>(await this.chamar<unknown>('GET', '/contacts', { email, limit: '200' }), 'contacts', '/contacts');
  }

  async tarefasDaNegociacao(id: string): Promise<TarefaCrm[]> {
    return listaDe<TarefaCrm>(await this.chamar<unknown>('GET', '/tasks', { deal_id: id, limit: '200' }), 'tasks', '/tasks');
  }

  async atualizarCamposPersonalizados(id: string, campos: CampoParaGravar[]): Promise<void> {
    await this.chamar('PUT', `/deals/${encodeURIComponent(id)}`, {}, { deal: { deal_custom_fields: campos } });
  }

  async criarTarefa(tarefa: NovaTarefa): Promise<void> {
    await this.chamar('POST', '/tasks', {}, { task: tarefa });
  }

  // -------------------------------------------------------------------------

  private dormir(ms: number): Promise<void> {
    if (this.opcoes.dormir) return this.opcoes.dormir(ms);
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Reserva a próxima vaga de chamada, respeitando o intervalo mínimo. */
  private aguardarVez(): Promise<void> {
    const intervalo = this.opcoes.intervaloMs ?? 600;
    const minhaVez = this.fila.then(async () => {
      const espera = this.proximaLiberada - Date.now();
      if (espera > 0) await this.dormir(espera);
      this.proximaLiberada = Date.now() + intervalo;
    });
    this.fila = minhaVez.catch(() => undefined);
    return minhaVez;
  }

  private async chamar<T>(
    metodo: 'GET' | 'PUT' | 'POST',
    caminho: string,
    params: Record<string, string> = {},
    corpo?: unknown,
  ): Promise<T> {
    const base = (this.opcoes.base ?? 'https://crm.rdstation.com/api/v1').replace(/\/+$/, '');
    const url = `${base}${caminho}?${new URLSearchParams({ ...params, token: this.token }).toString()}`;
    const buscador: Buscador = this.opcoes.buscador ?? (fetch as unknown as Buscador);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (corpo !== undefined) headers['Content-Type'] = 'application/json';
    const ehLeitura = metodo === 'GET';

    let falhas = 0;
    let pausas = 0;
    const repetirLeitura = async (): Promise<boolean> => {
      if (!ehLeitura || ++falhas >= 3) return false;
      await this.dormir(2000 * falhas);
      return true;
    };

    for (;;) {
      await this.aguardarVez();
      this.chamadas++;

      let resp: RespostaHttp;
      try {
        resp = await buscador(url, {
          method: metodo,
          headers,
          body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
          signal: AbortSignal.timeout(this.opcoes.timeoutMs ?? 15000),
        });
      } catch (err) {
        if (await repetirLeitura()) continue;
        const tipo = err instanceof Error ? err.name : 'erro';
        throw new ErroCrm(`${metodo} ${caminho}: sem resposta do CRM (${tipo})`);
      }

      if (resp.status === 429 && ehLeitura && pausas < 3) {
        pausas++;
        const segundos = Number(resp.headers.get('retry-after'));
        const espera = Number.isFinite(segundos) && segundos > 0 ? Math.min(segundos, MAXIMO_RETRY_AFTER_S) : 60;
        await this.dormir(espera * 1000);
        continue;
      }
      if (resp.status >= 500 && (await repetirLeitura())) continue;

      let texto: string;
      try {
        texto = await resp.text();
      } catch {
        if (await repetirLeitura()) continue;
        throw new ErroCrm(`${metodo} ${caminho}: resposta do CRM incompleta`, resp.status);
      }
      if (!resp.ok) throw new ErroCrm(`${metodo} ${caminho}: o CRM respondeu HTTP ${resp.status}`, resp.status);
      if (!texto.trim()) {
        if (!ehLeitura) return undefined as T;
        if (await repetirLeitura()) continue;
        throw new ErroCrm(`${metodo} ${caminho}: resposta vazia do CRM`, resp.status);
      }
      try {
        return JSON.parse(texto) as T;
      } catch {
        if (await repetirLeitura()) continue;
        throw new ErroCrm(`${metodo} ${caminho}: o CRM respondeu algo que não é JSON`, resp.status);
      }
    }
  }
}
