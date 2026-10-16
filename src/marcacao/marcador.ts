import { normalizarEmail, normalizarTelefone } from '../imoveis/dado-cliente.controller';
import { ConfigMarcacao } from './config';
import { classificar, Classificacao, NegociacaoResumo, TipoEntrada } from './classificador';
import {
  ApiCrm,
  CampoParaGravar,
  CampoPersonalizadoCrm,
  ContatoCrm,
  NegociacaoCrm,
  NegociacaoDoContato,
} from './crm.client';
import { Decisao, Registro } from './registro';
import { criadaEmPeloId, prazoUtil } from './tempo';
import { ASSUNTO_DUPLICADO, ASSUNTO_RETORNO, textoDuplicado, textoRetorno } from './texto-tarefa';

/**
 * Uma rodada da marcação: lista as negociações criadas nas últimas 24 h, pega
 * as dos funis da marcação que já passaram pela roleta e ainda não foram
 * processadas, procura outras negociações dos mesmos contatos e marca cada uma
 * como Novo, Retorno ou Possível duplicado.
 *
 * Cuidados para não quebrar nada:
 * - só grava nos modos teste e ativo, e no modo teste só no Funil de Testes
 *   com contatos da lista EMAILS_TESTE;
 * - relê a negociação logo antes de gravar: ganha ou perdida, não grava nada;
 * - campo já preenchido por alguém: não troca o valor (só cria a tarefa);
 * - depois de gravar, confere se os outros campos continuam iguais; se algum
 *   mudou, para de gravar até a API reiniciar (disjuntor);
 * - antes de criar a tarefa, confere se ela já existe.
 */

export interface LogMarcacao {
  info(mensagem: string): void;
  aviso(mensagem: string): void;
  erro(mensagem: string): void;
}

/** Leitura do histórico (só leitura): como a marcação teria classificado os últimos dias. */
export interface EstadoHistorico {
  rodando: boolean;
  dias: number;
  inicio: string;
  fim: string | null;
  erro: string | null;
  total: number;
  lidas: number;
  erros: number;
  novo: number;
  retorno: number;
  duplicado: number;
  /** funil -> tipo -> quantidade */
  porFunil: Record<string, Record<string, number>>;
  /** Uma linha por negociação, para conferir com a equipe (só IDs, sem dados de clientes). */
  negociacoes: { negociacao: string; criadaEm: string; funil: string; tipo: TipoEntrada | null; anteriores: number }[];
}

export interface ResumoRodada {
  inicio: string;
  fim: string | null;
  modo: string;
  lidas: number;
  processadas: number;
  aguardando: number;
  novo: number;
  retorno: number;
  duplicado: number;
  gravadas: number;
  tarefas: number;
  erros: number;
  chamadas: number;
  /** Erro que interrompeu a rodada inteira (ex.: CRM fora do ar). */
  erro: string | null;
}

const JANELA_HORAS = 24;
const MAXIMO_POR_RODADA = 40;
const MAXIMO_RELACIONADAS = 10;
const RECARREGAR_LISTAS_MS = 6 * 3600_000;
const MAXIMO_TENTATIVAS = 3;
const GUARDAR_PROCESSADAS_DIAS = 3;
const MAXIMO_PAGINAS_HISTORICO = 25;

export const idDe = (x: { id?: string; _id?: string } | null | undefined): string | null =>
  x ? String(x.id ?? x._id ?? '') || null : null;

const mensagem = (err: unknown): string => (err instanceof Error ? err.message : String(err));

function unicos<T>(itens: (T | null | undefined)[]): T[] {
  return [...new Set(itens.filter((x): x is T => x !== null && x !== undefined))];
}

function estaFechada(d: NegociacaoCrm): boolean {
  return d.win === true || d.win === false || Boolean(d.closed_at);
}

function idDoCampo(cf: CampoPersonalizadoCrm): string | null {
  return cf.custom_field_id ?? idDe(cf.custom_field ?? null);
}

function textoDoValor(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  if (Array.isArray(valor)) return valor.map((v) => String(v)).join(', ').trim();
  return String(valor).trim();
}

export function valorDoCampo(d: NegociacaoCrm, campoId: string): string {
  const campo = (d.deal_custom_fields ?? []).find((cf) => idDoCampo(cf) === campoId);
  return campo ? textoDoValor(campo.value) : '';
}

/** Campos que tinham valor antes e sumiram ou mudaram depois. */
export function camposAlterados(antes: CampoPersonalizadoCrm[], depois: CampoPersonalizadoCrm[]): string[] {
  const valoresDepois = new Map<string, string>();
  for (const cf of depois) {
    const id = idDoCampo(cf);
    if (id) valoresDepois.set(id, textoDoValor(cf.value));
  }
  const alterados: string[] = [];
  for (const cf of antes) {
    const id = idDoCampo(cf);
    const valor = textoDoValor(cf.value);
    if (!id || !valor) continue;
    if (valoresDepois.get(id) !== valor) alterados.push(id);
  }
  return alterados;
}

export class Marcador {
  ultimaRodada: ResumoRodada | null = null;
  historico: EstadoHistorico | null = null;
  /** Motivo para ter parado de gravar; null enquanto está tudo certo. */
  disjuntor: string | null = null;

  private funis = new Map<string, string>();
  private etapaParaFunil = new Map<string, string>();
  private motivosPerda = new Map<string, string>();
  private listasCarregadasEm = 0;
  private falhas = new Map<string, number>();

  constructor(
    private readonly cfg: ConfigMarcacao,
    private readonly api: ApiCrm,
    private readonly registro: Registro,
    private readonly log: LogMarcacao,
    private readonly relogio: () => Date = () => new Date(),
  ) {}

  async rodada(): Promise<ResumoRodada> {
    const inicio = this.relogio();
    const chamadasAntes = this.api.chamadas;
    const resumo: ResumoRodada = {
      inicio: inicio.toISOString(),
      fim: null,
      modo: this.cfg.modo,
      lidas: 0,
      processadas: 0,
      aguardando: 0,
      novo: 0,
      retorno: 0,
      duplicado: 0,
      gravadas: 0,
      tarefas: 0,
      erros: 0,
      chamadas: 0,
      erro: null,
    };
    this.ultimaRodada = resumo;
    try {
      await this.executarRodada(inicio, resumo);
    } catch (err) {
      resumo.erro = mensagem(err);
      throw err;
    } finally {
      resumo.fim = this.relogio().toISOString();
      resumo.chamadas = this.api.chamadas - chamadasAntes;
    }
    if (resumo.processadas || resumo.erros) {
      this.log.info(
        `rodada (${this.cfg.modo}): ${resumo.processadas} processadas (${resumo.novo} Novo, ` +
          `${resumo.retorno} Retorno, ${resumo.duplicado} Possível duplicado), ${resumo.gravadas} campos ` +
          `gravados, ${resumo.tarefas} tarefas, ${resumo.erros} erros, ${resumo.chamadas} chamadas ao CRM`,
      );
    }
    return resumo;
  }

  private async executarRodada(inicio: Date, resumo: ResumoRodada): Promise<void> {
    await this.carregarListas(inicio);

    const desde = new Date(inicio.getTime() - JANELA_HORAS * 3600_000);
    const lista = await this.api.listarNegociacoesCriadasEntre(desde, inicio);
    resumo.lidas = lista.length;

    const funisDaMarcacao = new Set([...this.cfg.funisPermitidos, this.cfg.funilTestes]);
    const prontas: NegociacaoCrm[] = [];
    for (const d of lista) {
      const id = idDe(d);
      const funil = this.funilDe(d);
      // Etapa criada depois da última leitura dos funis: relê na próxima rodada
      if (!funil && idDe(d.deal_stage ?? null)) this.listasCarregadasEm = 0;
      const criada = Date.parse(d.created_at ?? '');
      if (!id || !funil || !funisDaMarcacao.has(funil) || !Number.isFinite(criada)) continue;
      if (this.registro.jaProcessada(id)) continue;
      if (inicio.getTime() - criada < this.cfg.esperaMinutos * 60_000) {
        resumo.aguardando++;
        continue;
      }
      prontas.push(d);
    }
    prontas.sort((a, b) => Date.parse(a.created_at as string) - Date.parse(b.created_at as string));
    if (prontas.length > MAXIMO_POR_RODADA) resumo.aguardando += prontas.length - MAXIMO_POR_RODADA;

    for (const d of prontas.slice(0, MAXIMO_POR_RODADA)) {
      const id = idDe(d) as string;
      try {
        const decisao = await this.processar(d);
        this.registro.anotar(decisao);
        this.registro.marcarProcessada(id, this.relogio());
        this.falhas.delete(id);
        resumo.processadas++;
        if (decisao.tipo === 'Novo') resumo.novo++;
        if (decisao.tipo === 'Retorno') resumo.retorno++;
        if (decisao.tipo === 'Possível duplicado') resumo.duplicado++;
        if (decisao.campo === 'gravado') resumo.gravadas++;
        if (decisao.tarefa === 'criada') resumo.tarefas++;
      } catch (err) {
        resumo.erros++;
        const tentativas = (this.falhas.get(id) ?? 0) + 1;
        this.falhas.set(id, tentativas);
        this.log.aviso(`negociação ${id}: ${mensagem(err)} (tentativa ${tentativas} de ${MAXIMO_TENTATIVAS})`);
        if (tentativas >= MAXIMO_TENTATIVAS) {
          this.registro.anotar({
            em: this.relogio().toISOString(),
            negociacao: id,
            funil: this.nomeDoFunil(this.funilDe(d)),
            modo: this.cfg.modo,
            tipo: null,
            acao: 'erro',
            campo: 'não gravado',
            tarefa: 'não criada',
            anteriores: [],
            observacao: `desistiu depois de ${MAXIMO_TENTATIVAS} tentativas: ${mensagem(err)}`,
          });
          this.registro.marcarProcessada(id, this.relogio());
          this.falhas.delete(id);
        }
      }
    }

    this.registro.esquecerAntesDe(new Date(inicio.getTime() - GUARDAR_PROCESSADAS_DIAS * 24 * 3600_000));
    await this.registro.salvar();
  }

  /**
   * Classifica as negociações dos funis permitidos criadas nos últimos `dias`,
   * sem gravar nada e sem mexer no registro das rodadas. É o teste com o
   * histórico da Fase 3. Usa o mesmo cliente (e o mesmo limite de chamadas).
   */
  async lerHistorico(dias: number): Promise<EstadoHistorico> {
    if (this.historico?.rodando) throw new Error('a leitura do histórico já está rodando');
    const inicio = this.relogio();
    const estado: EstadoHistorico = {
      rodando: true,
      dias,
      inicio: inicio.toISOString(),
      fim: null,
      erro: null,
      total: 0,
      lidas: 0,
      erros: 0,
      novo: 0,
      retorno: 0,
      duplicado: 0,
      porFunil: {},
      negociacoes: [],
    };
    this.historico = estado;

    try {
      await this.carregarListas(inicio);
      const desde = new Date(inicio.getTime() - dias * 24 * 3600_000);
      const lista = await this.api.listarNegociacoesCriadasEntre(desde, inicio, MAXIMO_PAGINAS_HISTORICO);
      const permitidos = new Set(this.cfg.funisPermitidos);
      const alvo = lista
        .filter((d) => {
          const funil = this.funilDe(d);
          return idDe(d) && funil && permitidos.has(funil) && Number.isFinite(Date.parse(d.created_at ?? ''));
        })
        .sort((a, b) => Date.parse(a.created_at as string) - Date.parse(b.created_at as string));
      estado.total = alvo.length;

      for (const d of alvo) {
        const funil = this.nomeDoFunil(this.funilDe(d));
        let tipo: TipoEntrada | null = null;
        let anteriores = 0;
        try {
          const decisao = await this.processar(d, true);
          tipo = decisao.tipo;
          anteriores = decisao.anteriores.length;
          if (tipo === 'Novo') estado.novo++;
          if (tipo === 'Retorno') estado.retorno++;
          if (tipo === 'Possível duplicado') estado.duplicado++;
          const doFunil = (estado.porFunil[funil] ??= {});
          doFunil[tipo as string] = (doFunil[tipo as string] ?? 0) + 1;
        } catch (err) {
          estado.erros++;
          this.log.aviso(`histórico, negociação ${idDe(d)}: ${mensagem(err)}`);
        }
        estado.lidas++;
        estado.negociacoes.push({ negociacao: idDe(d) as string, criadaEm: d.created_at as string, funil, tipo, anteriores });
      }
    } catch (err) {
      estado.erro = mensagem(err);
    } finally {
      estado.rodando = false;
      estado.fim = this.relogio().toISOString();
    }
    this.log.info(
      `histórico de ${dias} dias: ${estado.lidas} negociações (${estado.novo} Novo, ${estado.retorno} Retorno, ` +
        `${estado.duplicado} Possível duplicado), ${estado.erros} erros${estado.erro ? `; parou: ${estado.erro}` : ''}`,
    );
    return estado;
  }

  // -------------------------------------------------------------------------

  private async carregarListas(agora: Date): Promise<void> {
    if (this.funis.size && agora.getTime() - this.listasCarregadasEm < RECARREGAR_LISTAS_MS) return;

    const funis = await this.api.listarFunis();
    const nomes = new Map<string, string>();
    const etapas = new Map<string, string>();
    for (const f of funis) {
      const id = idDe(f);
      if (!id) continue;
      nomes.set(id, f.name ?? id);
      for (const e of f.deal_stages ?? []) {
        const etapa = idDe(e);
        if (etapa) etapas.set(etapa, id);
      }
    }
    if (!nomes.size) throw new Error('o CRM não devolveu os funis');
    this.funis = nomes;
    this.etapaParaFunil = etapas;

    try {
      this.motivosPerda = new Map((await this.api.listarMotivosPerda()).map((m) => [m.id, m.nome]));
    } catch (err) {
      this.log.aviso(`não consegui ler os motivos de perda: ${mensagem(err)}`);
    }
    this.listasCarregadasEm = agora.getTime();
  }

  private funilDe(d: NegociacaoCrm): string | null {
    const direto = idDe(d.deal_pipeline ?? null) ?? d.deal_stage?.deal_pipeline_id ?? null;
    if (direto) return direto;
    const etapa = idDe(d.deal_stage ?? null);
    return etapa ? (this.etapaParaFunil.get(etapa) ?? null) : null;
  }

  private nomeDoFunil(funilId: string | null): string {
    return funilId ? (this.funis.get(funilId) ?? funilId) : 'funil desconhecido';
  }

  /** Por que esta negociação não pode receber gravação agora (null = pode). */
  private motivoParaNaoGravar(funilId: string, ehContatoDeTeste: boolean): string | null {
    if (this.disjuntor) return `gravação suspensa: ${this.disjuntor}`;
    const ehFunilTestes = funilId === this.cfg.funilTestes;
    switch (this.cfg.modo) {
      case 'ativo':
        return ehFunilTestes && !ehContatoDeTeste ? 'Funil de Testes com contato fora da lista de teste' : null;
      case 'teste':
        if (!ehFunilTestes) return 'modo teste: só grava no Funil de Testes';
        return ehContatoDeTeste ? null : 'modo teste: contato fora da lista de teste';
      default:
        return 'modo simulação';
    }
  }

  private async processar(d: NegociacaoCrm, forcarSimulacao = false): Promise<Decisao> {
    const id = idDe(d) as string;
    const funilId = this.funilDe(d) as string;
    const ehFunilTestes = funilId === this.cfg.funilTestes;

    // 1) Contatos da negociação nova: a lista já traz telefone e e-mail
    let contatos: ContatoCrm[] = d.contacts ?? [];
    const temDados = (cs: ContatoCrm[]) =>
      cs.some((c) => (c.phones ?? []).some((p) => p?.phone) || (c.emails ?? []).some((e) => e?.email));
    if (!temDados(contatos)) contatos = await this.api.contatosDaNegociacao(id);

    const todosEmails = unicos(
      contatos.flatMap((c) => (c.emails ?? []).map((e) => (e?.email ? normalizarEmail(e.email) : null))),
    );
    const ehContatoDeTeste = todosEmails.some((e) => this.cfg.emailsTeste.includes(e));
    const emails = todosEmails.filter(
      (e) => this.cfg.emailsTeste.includes(e) || !this.cfg.dominiosInternos.some((dom) => e.endsWith(dom)),
    );
    // O CRM acha o número comparando só dígitos: DDD + número, sem o 55, acha
    // os gravados com ou sem 55, com + ou com máscara (teste de 16/10/2026)
    const telefones = unicos(
      contatos.flatMap((c) => (c.phones ?? []).map((p) => (p?.phone ? normalizarTelefone(p.phone) : null))),
    )
      .filter((t) => !this.cfg.telefonesInternos.includes(t))
      .map((t) => t.slice(2));

    const motivoSemGravar = forcarSimulacao
      ? 'leitura do histórico'
      : this.motivoParaNaoGravar(funilId, ehContatoDeTeste);

    // 2) Outras negociações dos mesmos contatos
    const relacionadas = await this.buscarRelacionadas(id, d.created_at as string, telefones, emails, !motivoSemGravar);

    // 3) Classificação
    const permitidos = new Set(this.cfg.funisPermitidos);
    if (ehFunilTestes) permitidos.add(this.cfg.funilTestes);
    const c = classificar({ id, criadaEm: d.created_at as string }, relacionadas, permitidos);

    const base = {
      em: this.relogio().toISOString(),
      negociacao: id,
      funil: this.nomeDoFunil(funilId),
      modo: this.cfg.modo,
      tipo: c.tipo,
      anteriores: c.anteriores.map((a) => a.id),
    };
    const semTarefa: Decisao['tarefa'] = c.tipo === 'Novo' ? 'não se aplica' : 'não criada';

    if (motivoSemGravar) {
      return { ...base, acao: 'simulou', campo: 'não gravado', tarefa: semTarefa, observacao: motivoSemGravar };
    }

    // 4) Relê a negociação logo antes de gravar
    const atual = await this.api.obterNegociacao(id);
    if (estaFechada(atual)) {
      return {
        ...base,
        acao: 'nada gravado',
        campo: 'não gravado',
        tarefa: semTarefa,
        observacao: 'negociação ganha ou perdida antes da marcação',
      };
    }

    const observacoes: string[] = [];

    // 5) Campo "Tipo de entrada": preenchido por alguém, fica como está
    let campo: Decisao['campo'];
    const valorAtual = valorDoCampo(atual, this.cfg.campoTipoEntrada);
    if (valorAtual) {
      campo = 'já preenchido';
      if (valorAtual !== c.tipo) observacoes.push(`campo preenchido à mão com "${valorAtual}"; a API calculou "${c.tipo}"`);
    } else {
      campo = await this.gravarCampo(id, atual, c.tipo, observacoes);
    }

    // 6) Tarefa para retorno e possível duplicado
    let tarefa: Decisao['tarefa'] = 'não se aplica';
    if (c.tipo !== 'Novo') tarefa = await this.criarTarefa(id, atual, c, observacoes);

    return {
      ...base,
      acao: campo === 'gravado' || tarefa === 'criada' ? 'gravou' : 'nada gravado',
      campo,
      tarefa,
      observacao: observacoes.length ? observacoes.join('; ') : undefined,
    };
  }

  /**
   * Negociações anteriores dos mesmos contatos. A busca de contatos já traz,
   * de cada cadastro, as negociações com situação (aberta, ganha, perdida);
   * a data de criação sai do ID. Abre (GET) as abertas, para saber o funil, e,
   * quando vai gravar, também as demais, para o texto da tarefa.
   */
  private async buscarRelacionadas(
    idNova: string,
    criadaEmNova: string,
    telefones: string[],
    emails: string[],
    detalharTodas: boolean,
  ): Promise<NegociacaoResumo[]> {
    const contatos: ContatoCrm[] = [];
    for (const t of telefones) contatos.push(...(await this.api.buscarContatosPorTelefone(t)));
    for (const e of emails) contatos.push(...(await this.api.buscarContatosPorEmail(e)));

    const tNova = Date.parse(criadaEmNova);
    const leves = new Map<string, NegociacaoResumo>();
    for (const contato of contatos) {
      for (const n of contato.deals ?? []) {
        const id = idDe(n);
        if (!id || id === idNova || leves.has(id)) continue;
        const resumo = this.resumoLeve(id, n);
        const t = resumo.criadaEm ? Date.parse(resumo.criadaEm) : NaN;
        // Só as anteriores; sem data confiável, abre para conferir
        if (Number.isFinite(t) && t >= tNova) continue;
        leves.set(id, resumo);
      }
    }

    const ordenadas = [...leves.values()]
      .sort((a, b) => (Date.parse(b.criadaEm ?? '') || 0) - (Date.parse(a.criadaEm ?? '') || 0))
      .slice(0, MAXIMO_RELACIONADAS);

    const resultado: NegociacaoResumo[] = [];
    for (const r of ordenadas) {
      if (r.aberta || detalharTodas || !r.criadaEm) {
        resultado.push(this.resumoCompleto(await this.api.obterNegociacao(r.id), r));
      } else {
        resultado.push(r);
      }
    }
    return resultado;
  }

  private resumoLeve(id: string, n: NegociacaoDoContato): NegociacaoResumo {
    const criada = criadaEmPeloId(id);
    const fechada = n.win === true || n.win === false || Boolean(n.closed_at);
    return {
      id,
      criadaEm: criada ? criada.toISOString() : null,
      aberta: !fechada,
      pausada: false,
      ganhou: n.win === true ? true : n.win === false ? false : null,
      fechadaEm: n.closed_at ?? null,
      motivoPerda: n.deal_lost_reason_id ? (this.motivosPerda.get(n.deal_lost_reason_id) ?? null) : null,
      funilId: null,
      funilNome: null,
      etapaNome: null,
      responsavelId: null,
      responsavelNome: null,
      atualizadaEm: null,
      detalhada: false,
    };
  }

  private resumoCompleto(d: NegociacaoCrm, leve: NegociacaoResumo): NegociacaoResumo {
    const funilId = this.funilDe(d);
    const motivoId = d.deal_lost_reason_id ?? idDe(d.deal_lost_reason ?? null);
    return {
      id: leve.id,
      criadaEm: d.created_at ?? leve.criadaEm,
      aberta: !estaFechada(d),
      pausada: d.hold === true,
      ganhou: d.win === true ? true : d.win === false ? false : null,
      fechadaEm: d.closed_at ?? null,
      motivoPerda: d.deal_lost_reason?.name ?? (motivoId ? (this.motivosPerda.get(motivoId) ?? null) : null),
      funilId,
      funilNome: funilId ? this.nomeDoFunil(funilId) : null,
      etapaNome: d.deal_stage?.name ?? null,
      responsavelId: idDe(d.user ?? null),
      responsavelNome: d.user?.name ?? null,
      atualizadaEm: d.updated_at ?? null,
      detalhada: true,
    };
  }

  private async gravarCampo(
    id: string,
    atual: NegociacaoCrm,
    tipo: TipoEntrada,
    observacoes: string[],
  ): Promise<Decisao['campo']> {
    const outros = (atual.deal_custom_fields ?? []).filter((cf) => {
      const campoId = idDoCampo(cf);
      return campoId && campoId !== this.cfg.campoTipoEntrada;
    });
    const campos: CampoParaGravar[] = [{ custom_field_id: this.cfg.campoTipoEntrada, value: tipo }];
    if (this.cfg.reenviarCampos) {
      for (const cf of outros) campos.push({ custom_field_id: idDoCampo(cf) as string, value: cf.value ?? null });
    }

    try {
      await this.api.atualizarCamposPersonalizados(id, campos);
    } catch (err) {
      observacoes.push(`campo não gravado: ${mensagem(err)}`);
      return 'não gravado';
    }

    // A documentação não diz se o PUT troca a lista inteira de campos.
    // Confere se algum outro campo mudou; se mudou, para de gravar.
    try {
      const depois = await this.api.obterNegociacao(id);
      const alterados = camposAlterados(outros, depois.deal_custom_fields ?? []);
      if (alterados.length) {
        this.disjuntor = `outros campos mudaram ao gravar a negociação ${id}`;
        this.log.erro(
          `ALERTA: ${alterados.length} campo(s) mudaram ao gravar "Tipo de entrada" na negociação ${id}. ` +
            'A marcação parou de gravar até a API reiniciar.',
        );
        observacoes.push(`ALERTA: ${alterados.length} outro(s) campo(s) mudaram; gravação suspensa`);
      }
      if (valorDoCampo(depois, this.cfg.campoTipoEntrada) !== tipo) {
        observacoes.push('o CRM não mostrou o valor gravado');
      }
    } catch (err) {
      observacoes.push(`não deu para conferir os outros campos: ${mensagem(err)}`);
    }
    return 'gravado';
  }

  private async criarTarefa(
    id: string,
    atual: NegociacaoCrm,
    c: Classificacao,
    observacoes: string[],
  ): Promise<Decisao['tarefa']> {
    const assunto = c.tipo === 'Retorno' ? ASSUNTO_RETORNO : ASSUNTO_DUPLICADO;
    const responsaveis = [idDe(atual.user ?? null)];
    if (c.tipo === 'Possível duplicado') responsaveis.push(...c.abertasPermitidas.map((a) => a.responsavelId));
    const usuarios = unicos(responsaveis);
    if (!usuarios.length) {
      observacoes.push('tarefa não criada: negociação sem responsável');
      return 'não criada';
    }

    const existentes = await this.api.tarefasDaNegociacao(id);
    if (existentes.some((t) => (t.subject ?? '').trim() === assunto)) return 'já existia';

    const campanha = atual.campaign?.name ?? null;
    const notas = c.tipo === 'Retorno' ? textoRetorno(c.anteriores, campanha) : textoDuplicado(c.abertasPermitidas, campanha);
    const prazo = prazoUtil(this.relogio(), 60);
    await this.api.criarTarefa({
      deal_id: id,
      user_ids: usuarios,
      subject: assunto,
      type: 'task',
      date: prazo.data,
      hour: prazo.hora,
      notes: notas,
      done: false,
    });
    return 'criada';
  }
}
