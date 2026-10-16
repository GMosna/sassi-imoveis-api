import { paraFiltroCrm } from './tempo';

/**
 * Cliente da API v1 do RD Station CRM usado pela marcação.
 * - O token vai só na URL da chamada; nunca entra em mensagem de erro ou log.
 * - Intervalo mínimo entre chamadas (padrão 600 ms = até 100 por minuto; o
 *   limite do CRM é 120), compartilhado por tudo que usa o mesmo cliente.
 * - Erro 429: espera o Retry-After (ou 60 s) e tenta de novo, até 3 vezes.
 * - GET repete em falha de rede ou erro 5xx; PUT e POST não repetem nesses
 *   casos, porque o CRM pode ter recebido a primeira tentativa.
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
    const lista = (r as { deal_pipelines?: FunilCrm[] } | undefined)?.deal_pipelines;
    return Array.isArray(lista) ? lista : [];
  }

  async listarMotivosPerda(): Promise<{ id: string; nome: string }[]> {
    const r = await this.chamar<{ deal_lost_reasons?: ReferenciaCrm[] }>('GET', '/deal_lost_reasons', { limit: '200' });
    return (r?.deal_lost_reasons ?? [])
      .map((m) => ({ id: String(m._id ?? m.id ?? ''), nome: String(m.name ?? '') }))
      .filter((m) => m.id);
  }

  async listarNegociacoesCriadasEntre(inicio: Date, fim: Date, maximoPaginas = MAXIMO_PAGINAS): Promise<NegociacaoCrm[]> {
    const todas: NegociacaoCrm[] = [];
    for (let pagina = 1; pagina <= maximoPaginas; pagina++) {
      const r = await this.chamar<{ deals?: NegociacaoCrm[]; has_more?: boolean }>('GET', '/deals', {
        created_at_period: 'true',
        start_date: paraFiltroCrm(inicio),
        end_date: paraFiltroCrm(fim),
        limit: '200',
        page: String(pagina),
      });
      const deals = Array.isArray(r?.deals) ? r.deals : [];
      todas.push(...deals);
      if (!r?.has_more || deals.length === 0) break;
    }
    return todas;
  }

  async obterNegociacao(id: string): Promise<NegociacaoCrm> {
    const r = await this.chamar<NegociacaoCrm>('GET', `/deals/${encodeURIComponent(id)}`);
    if (!r || typeof r !== 'object') throw new ErroCrm(`GET /deals/${id}: resposta vazia`);
    return r;
  }

  async contatosDaNegociacao(id: string): Promise<ContatoCrm[]> {
    const r = await this.chamar<{ contacts?: ContatoCrm[] }>('GET', `/deals/${encodeURIComponent(id)}/contacts`, { limit: '50' });
    return Array.isArray(r?.contacts) ? r.contacts : [];
  }

  async buscarContatosPorTelefone(telefone: string): Promise<ContatoCrm[]> {
    const r = await this.chamar<{ contacts?: ContatoCrm[] }>('GET', '/contacts', { phone: telefone, limit: '200' });
    return Array.isArray(r?.contacts) ? r.contacts : [];
  }

  async buscarContatosPorEmail(email: string): Promise<ContatoCrm[]> {
    const r = await this.chamar<{ contacts?: ContatoCrm[] }>('GET', '/contacts', { email, limit: '200' });
    return Array.isArray(r?.contacts) ? r.contacts : [];
  }

  async tarefasDaNegociacao(id: string): Promise<TarefaCrm[]> {
    const r = await this.chamar<{ tasks?: TarefaCrm[] }>('GET', '/tasks', { deal_id: id, limit: '200' });
    return Array.isArray(r?.tasks) ? r.tasks : [];
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

  private resumirErro(texto: string): string {
    if (!texto) return '';
    let detalhe = texto;
    try {
      const corpo = JSON.parse(texto);
      detalhe = typeof corpo?.error === 'string' ? corpo.error : JSON.stringify(corpo?.errors ?? corpo);
    } catch {
      // corpo não é JSON
    }
    detalhe = detalhe.split(this.token).join('***').replace(/\s+/g, ' ').slice(0, 150);
    return detalhe ? ` (${detalhe})` : '';
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

    let falhas = 0;
    let pausas = 0;
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
        if (metodo === 'GET' && ++falhas < 3) {
          await this.dormir(2000 * falhas);
          continue;
        }
        const tipo = err instanceof Error ? err.name : 'erro';
        throw new ErroCrm(`${metodo} ${caminho}: sem resposta do CRM (${tipo})`);
      }

      if (resp.status === 429 && pausas < 3) {
        pausas++;
        const segundos = Number(resp.headers.get('retry-after'));
        await this.dormir((Number.isFinite(segundos) && segundos > 0 ? segundos : 60) * 1000);
        continue;
      }
      if (resp.status >= 500 && metodo === 'GET' && ++falhas < 3) {
        await this.dormir(2000 * falhas);
        continue;
      }

      const texto = await resp.text().catch(() => '');
      if (!resp.ok) {
        throw new ErroCrm(`${metodo} ${caminho}: o CRM respondeu HTTP ${resp.status}${this.resumirErro(texto)}`, resp.status);
      }
      if (!texto.trim()) return undefined as T;
      try {
        return JSON.parse(texto) as T;
      } catch {
        throw new ErroCrm(`${metodo} ${caminho}: o CRM respondeu algo que não é JSON`, resp.status);
      }
    }
  }
}
