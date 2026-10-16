import { normalizarEmail, normalizarTelefone } from '../imoveis/dado-cliente.controller';
import { ConfigMarcacao } from './config';
import { classificar, Classificacao, NegociacaoResumo, TipoEntrada } from './classificador';
import {
  ApiCrm,
  CampoParaGravar,
  CampoPersonalizadoCrm,
  ContatoCrm,
  ErroCrm,
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
 * - relê a negociação logo antes de gravar: se mudou de funil, foi ganha ou
 *   perdida, não grava nada;
 * - campo já preenchido por alguém: não troca o valor (só cria a tarefa);
 * - depois de qualquer gravação, relê e confere se os outros campos continuam
 *   iguais; se algum mudou, ou se não der para conferir, para de gravar
 *   (disjuntor guardado em disco, liberado só por POST /marcacao/religar).
 *   Enquanto está parada, nenhuma negociação é processada: todas esperam a
 *   liberação e são vistas depois (dentro da janela de 24 h);
 * - antes de criar a tarefa, confere se ela já existe;
 * - negociação do Funil de Testes só é comparada com o Funil de Testes, para
 *   um teste nunca gerar tarefa para responsável de negociação real.
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
  /** Rodada não processou nada porque a gravação está suspensa. */
  suspensa: boolean;
}

const JANELA_HORAS = 24;
const MAXIMO_POR_RODADA = 40;
const MAXIMO_ABERTAS = 15;
const MAXIMO_FECHADAS = 10;
const RECARREGAR_LISTAS_MS = 6 * 3600_000;
const MAXIMO_TENTATIVAS = 3;
const GUARDAR_PROCESSADAS_DIAS = 3;
const MAXIMO_PAGINAS_HISTORICO = 25;
/**
 * A extração do telefone fica lenta com textos muito longos: o campo é lido
 * com espaços juntados e até 100 caracteres. E-mail com mais de 254 não existe.
 */
const MAXIMO_TELEFONE = 100;
const MAXIMO_EMAIL = 254;

export const idDe = (x: { id?: string; _id?: string } | null | undefined): string | null =>
  x ? String(x.id ?? x._id ?? '') || null : null;

const mensagem = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const dormir = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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

/** Telefones (55DDNUMERO) e e-mails (minúsculos) dos contatos. */
function dadosDosContatos(contatos: ContatoCrm[]): { telefones: string[]; emails: string[] } {
  const telefones = unicos(
    contatos.flatMap((c) =>
      (c.phones ?? []).map((p) => {
        const t = p?.phone;
        if (typeof t !== 'string') return null;
        return normalizarTelefone(t.replace(/\s+/g, ' ').trim().slice(0, MAXIMO_TELEFONE));
      }),
    ),
  );
  const emails = unicos(
    contatos.flatMap((c) =>
      (c.emails ?? []).map((e) => {
        const v = e?.email;
        return typeof v === 'string' && v.length <= MAXIMO_EMAIL ? normalizarEmail(v) : null;
      }),
    ),
  );
  return { telefones, emails };
}

function contatoTemTelefone(c: ContatoCrm, digitosBuscados: string): boolean {
  return (c.phones ?? []).some(
    (p) => typeof p?.phone === 'string' && p.phone.replace(/\D/g, '').includes(digitosBuscados),
  );
}

/**
 * Erro de gravação com desfecho incerto: o CRM pode ter gravado (rede, tempo
 * esgotado, erro 5xx, resposta de sucesso que não deu para ler). Só uma recusa
 * 4xx garante que nada foi gravado.
 */
function podeTerGravado(erro: unknown): boolean {
  if (!erro) return true;
  if (!(erro instanceof ErroCrm) || erro.status === undefined) return true;
  return erro.status < 400 || erro.status >= 500;
}

function contatoTemEmail(c: ContatoCrm, email: string): boolean {
  return (c.emails ?? []).some((e) => typeof e?.email === 'string' && e.email.trim().toLowerCase() === email);
}

export class Marcador {
  ultimaRodada: ResumoRodada | null = null;
  historico: EstadoHistorico | null = null;

  private emRodada = false;
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

  /** Motivo para ter parado de gravar (guardado em disco); null enquanto está tudo certo. */
  get disjuntor(): string | null {
    return this.registro.disjuntor?.motivo ?? null;
  }

  /** Libera a gravação depois que alguém conferiu o CRM. */
  async religar(): Promise<boolean> {
    if (!this.registro.disjuntor) return false;
    this.registro.definirDisjuntor(null);
    await this.registro.salvar();
    this.log.aviso('gravação liberada de novo pela rota /marcacao/religar');
    return true;
  }

  private async dispararDisjuntor(motivo: string): Promise<void> {
    if (this.registro.disjuntor) return;
    this.registro.definirDisjuntor({ motivo, em: this.relogio().toISOString() });
    this.log.erro(`ALERTA: ${motivo}. A marcação parou de gravar até alguém liberar em POST /marcacao/religar.`);
    await this.registro.salvar();
  }

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
      suspensa: false,
    };
    this.ultimaRodada = resumo;
    this.emRodada = true;
    try {
      await this.executarRodada(inicio, resumo);
    } catch (err) {
      resumo.erro = mensagem(err);
      throw err;
    } finally {
      this.emRodada = false;
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

  /** Gravação suspensa num modo que grava: nada é processado até a liberação. */
  private gravacaoSuspensa(): boolean {
    return Boolean(this.disjuntor) && this.cfg.modo !== 'simulacao';
  }

  private async executarRodada(inicio: Date, resumo: ResumoRodada): Promise<void> {
    if (this.gravacaoSuspensa()) {
      resumo.suspensa = true;
      this.log.aviso(`marcação parada: ${this.disjuntor}. Depois de conferir o CRM, libere em POST /marcacao/religar.`);
      return;
    }
    await this.carregarListas(inicio);

    const desde = new Date(inicio.getTime() - JANELA_HORAS * 3600_000);
    const lista = await this.api.listarNegociacoesCriadasEntre(desde, inicio);
    resumo.lidas = lista.length;

    const funisDaMarcacao = new Set([...this.cfg.funisPermitidos, this.cfg.funilTestes]);
    const vistas = new Set<string>();
    const prontas: NegociacaoCrm[] = [];
    for (const d of lista) {
      const id = idDe(d);
      if (!id || vistas.has(id)) continue;
      vistas.add(id);
      const funil = this.funilDe(d);
      // Etapa criada depois da última leitura dos funis: relê na próxima rodada
      if (!funil && idDe(d.deal_stage ?? null)) this.listasCarregadasEm = 0;
      const criada = Date.parse(d.created_at ?? '');
      if (!funil || !funisDaMarcacao.has(funil) || !Number.isFinite(criada)) continue;
      // Não depende só do filtro de data do CRM
      if (criada < desde.getTime() || criada > inicio.getTime()) continue;
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
      // Gravação suspensa no meio da rodada: as demais esperam a liberação
      if (this.gravacaoSuspensa()) {
        resumo.aguardando++;
        resumo.suspensa = true;
        continue;
      }
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
        // A gravação foi suspensa durante esta negociação: não conta como
        // tentativa, ela volta inteira depois da liberação.
        if (this.gravacaoSuspensa()) {
          this.log.aviso(`negociação ${id}: ${mensagem(err)} (volta depois da liberação)`);
          continue;
        }
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
   * histórico da Fase 3. Usa o mesmo cliente (e o mesmo limite de chamadas) e
   * dá a vez às rodadas: enquanto uma rodada roda, o histórico espera.
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
      const vistas = new Set<string>();
      const alvo = lista
        .filter((d) => {
          const id = idDe(d);
          const funil = this.funilDe(d);
          const criada = Date.parse(d.created_at ?? '');
          if (!id || vistas.has(id) || !funil || !permitidos.has(funil) || !Number.isFinite(criada)) return false;
          if (criada < desde.getTime() || criada > inicio.getTime()) return false;
          vistas.add(id);
          return true;
        })
        .sort((a, b) => Date.parse(a.created_at as string) - Date.parse(b.created_at as string));
      estado.total = alvo.length;

      for (const d of alvo) {
        while (this.emRodada) await dormir(1000);
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

  /** Por que esta negociação não pode receber gravação (null = pode). A suspensão é tratada à parte. */
  private motivoParaNaoGravar(funilId: string, ehContatoDeTeste: boolean): string | null {
    const ehFunilTestes = funilId === this.cfg.funilTestes;
    switch (this.cfg.modo) {
      case 'ativo':
        if (ehFunilTestes) return ehContatoDeTeste ? null : 'Funil de Testes com contato fora da lista de teste';
        return this.cfg.funisPermitidos.includes(funilId) ? null : 'funil fora da marcação';
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
    // Suspensa: a negociação não é marcada como processada e volta depois da liberação
    if (!forcarSimulacao && this.gravacaoSuspensa()) throw new Error(`gravação suspensa: ${this.disjuntor}`);

    // 1) Contatos da negociação nova: a lista já traz telefone e e-mail
    let contatos: ContatoCrm[] = d.contacts ?? [];
    let dados = dadosDosContatos(contatos);
    if (!dados.telefones.length && !dados.emails.length) {
      contatos = await this.api.contatosDaNegociacao(id);
      dados = dadosDosContatos(contatos);
    }
    const ehContatoDeTeste = dados.emails.some((e) => this.cfg.emailsTeste.includes(e));
    const emails = dados.emails.filter(
      (e) => this.cfg.emailsTeste.includes(e) || !this.cfg.dominiosInternos.some((dom) => e.endsWith(dom)),
    );
    // O CRM acha o número comparando só dígitos: DDD + número, sem o 55, acha
    // os gravados com ou sem 55, com + ou com máscara (teste de 16/10/2026)
    const telefones = dados.telefones.filter((t) => !this.cfg.telefonesInternos.includes(t)).map((t) => t.slice(2));

    const motivoSemGravar = forcarSimulacao ? 'leitura do histórico' : this.motivoParaNaoGravar(funilId, ehContatoDeTeste);

    // 2) Outras negociações dos mesmos contatos
    const relacionadas = await this.buscarRelacionadas(id, d.created_at as string, telefones, emails, !motivoSemGravar);

    // 3) Classificação. Negociação do Funil de Testes só se compara com o
    // Funil de Testes: assim um teste nunca vira tarefa de responsável real.
    const permitidos = ehFunilTestes ? new Set([this.cfg.funilTestes]) : new Set(this.cfg.funisPermitidos);
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
    const semGravar = (acao: Decisao['acao'], observacao: string): Decisao => ({
      ...base,
      acao,
      campo: 'não gravado',
      tarefa: semTarefa,
      observacao,
    });

    if (motivoSemGravar) return semGravar('simulou', motivoSemGravar);

    // 4) Relê logo antes de gravar e confere tudo de novo. Mudou de funil:
    // não grava agora; a próxima rodada vê a negociação no funil novo.
    const atual = await this.api.obterNegociacao(id);
    const funilAtual = this.funilDe(atual);
    if (funilAtual !== funilId) throw new Error('a negociação mudou de funil antes da gravação; volta na próxima rodada');
    if (estaFechada(atual)) return semGravar('nada gravado', 'negociação ganha ou perdida antes da marcação');
    if (this.gravacaoSuspensa()) throw new Error(`gravação suspensa: ${this.disjuntor}`);
    const motivoAgora = this.motivoParaNaoGravar(funilAtual, ehContatoDeTeste);
    if (motivoAgora) return semGravar('simulou', motivoAgora);
    if (!Array.isArray(atual.deal_custom_fields)) {
      throw new Error('o CRM devolveu a negociação sem os campos personalizados');
    }

    const observacoes: string[] = [];

    // 5) Campo "Tipo de entrada": preenchido por alguém, fica como está
    let campo: Decisao['campo'];
    let depois: NegociacaoCrm = atual;
    const valorAtual = valorDoCampo(atual, this.cfg.campoTipoEntrada);
    if (valorAtual) {
      campo = 'já preenchido';
      if (valorAtual !== c.tipo) observacoes.push(`campo preenchido à mão com "${valorAtual}"; a API calculou "${c.tipo}"`);
    } else {
      const gravacao = await this.gravarCampo(id, atual, c.tipo, observacoes);
      campo = gravacao.campo;
      depois = gravacao.depois;
    }

    // 6) Tarefa para retorno e possível duplicado
    let tarefa: Decisao['tarefa'] = 'não se aplica';
    if (c.tipo !== 'Novo') {
      if (this.gravacaoSuspensa()) {
        throw new Error(`gravação suspensa: ${this.disjuntor}`);
      } else if (estaFechada(depois)) {
        tarefa = 'não criada';
        observacoes.push('tarefa não criada: a negociação foi ganha ou perdida durante a marcação');
      } else {
        tarefa = await this.criarTarefa(id, depois, c, observacoes);
      }
    }

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
   * a data de criação sai do ID. As abertas sempre entram (são elas que
   * decidem o possível duplicado) e são abertas (GET) para saber o funil;
   * quando vai gravar, as demais também, para o texto da tarefa.
   */
  private async buscarRelacionadas(
    idNova: string,
    criadaEmNova: string,
    telefones: string[],
    emails: string[],
    detalharTodas: boolean,
  ): Promise<NegociacaoResumo[]> {
    // Confere que o CRM devolveu só cadastros com o telefone ou o e-mail buscado
    const contatos: ContatoCrm[] = [];
    for (const t of telefones) {
      contatos.push(...(await this.api.buscarContatosPorTelefone(t)).filter((c) => contatoTemTelefone(c, t)));
    }
    for (const e of emails) {
      contatos.push(...(await this.api.buscarContatosPorEmail(e)).filter((c) => contatoTemEmail(c, e)));
    }

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

    const porData = (a: NegociacaoResumo, b: NegociacaoResumo) =>
      (Date.parse(b.criadaEm ?? '') || 0) - (Date.parse(a.criadaEm ?? '') || 0);
    const todas = [...leves.values()].sort(porData);
    const escolhidas = [
      ...todas.filter((r) => r.aberta).slice(0, MAXIMO_ABERTAS),
      ...todas.filter((r) => !r.aberta).slice(0, MAXIMO_FECHADAS),
    ];

    const resultado: NegociacaoResumo[] = [];
    for (const r of escolhidas) {
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

  /**
   * Grava o "Tipo de entrada" e devolve a negociação relida depois.
   * - Sempre relê e confere depois de enviar, mesmo se o CRM respondeu com
   *   erro: com rede, tempo esgotado, erro 5xx ou resposta ilegível, ele pode
   *   ter gravado.
   * - Outros campos mudaram: dispara o disjuntor e lança erro, para a
   *   negociação voltar depois da liberação (sem tarefa até lá).
   * - Não deu para reler depois de um envio que pode ter gravado: disjuntor.
   * - Valor não gravado: erro temporário (rede, 5xx, 429) volta na próxima
   *   rodada; recusa definitiva (outro 4xx) ou CRM que aceitou e não guardou
   *   ficam registrados, sem repetir, e a tarefa é criada assim mesmo.
   */
  private async gravarCampo(
    id: string,
    atual: NegociacaoCrm,
    tipo: TipoEntrada,
    observacoes: string[],
  ): Promise<{ campo: Decisao['campo']; depois: NegociacaoCrm }> {
    const outros = (atual.deal_custom_fields ?? []).filter((cf) => {
      const campoId = idDoCampo(cf);
      return campoId && campoId !== this.cfg.campoTipoEntrada;
    });
    const campos: CampoParaGravar[] = [{ custom_field_id: this.cfg.campoTipoEntrada, value: tipo }];
    if (this.cfg.reenviarCampos) {
      for (const cf of outros) campos.push({ custom_field_id: idDoCampo(cf) as string, value: cf.value ?? null });
    }

    let erroAoGravar: unknown = null;
    try {
      await this.api.atualizarCamposPersonalizados(id, campos);
    } catch (err) {
      erroAoGravar = err;
    }

    const incerto = podeTerGravado(erroAoGravar);

    let depois: NegociacaoCrm;
    try {
      depois = await this.api.obterNegociacao(id);
      if (!Array.isArray(depois.deal_custom_fields)) throw new Error('resposta sem os campos personalizados');
    } catch (err) {
      if (incerto) {
        await this.dispararDisjuntor(`não deu para conferir os outros campos depois de gravar a negociação ${id}`);
      }
      throw new Error(`não deu para conferir os campos depois de gravar: ${mensagem(err)}`);
    }

    const alterados = camposAlterados(outros, depois.deal_custom_fields);
    if (alterados.length) {
      await this.dispararDisjuntor(
        `${alterados.length} outro(s) campo(s) mudaram ao gravar "Tipo de entrada" na negociação ${id}`,
      );
      throw new Error(`gravação suspensa: ${alterados.length} outro(s) campo(s) mudaram`);
    }

    if (valorDoCampo(depois, this.cfg.campoTipoEntrada) === tipo) {
      if (erroAoGravar) observacoes.push(`o CRM respondeu com erro, mas gravou (${mensagem(erroAoGravar)})`);
      return { campo: 'gravado', depois };
    }

    // Não gravou. Erro temporário: tenta de novo na próxima rodada.
    const temporario =
      erroAoGravar !== null &&
      (incerto || (erroAoGravar instanceof ErroCrm && erroAoGravar.status === 429));
    if (temporario) throw erroAoGravar;
    observacoes.push(
      erroAoGravar ? `campo não gravado: ${mensagem(erroAoGravar)}` : 'o CRM aceitou, mas não mostrou o valor gravado',
    );
    return { campo: 'não gravado', depois };
  }

  private async criarTarefa(
    id: string,
    negociacao: NegociacaoCrm,
    c: Classificacao,
    observacoes: string[],
  ): Promise<Decisao['tarefa']> {
    const assunto = c.tipo === 'Retorno' ? ASSUNTO_RETORNO : ASSUNTO_DUPLICADO;
    const responsaveis = [idDe(negociacao.user ?? null)];
    if (c.tipo === 'Possível duplicado') responsaveis.push(...c.abertasPermitidas.map((a) => a.responsavelId));
    const usuarios = unicos(responsaveis);
    if (!usuarios.length) {
      observacoes.push('tarefa não criada: negociação sem responsável');
      return 'não criada';
    }

    // Descarta só tarefa que diz ser de outra negociação; sem essa informação, conta como desta
    const existentes = (await this.api.tarefasDaNegociacao(id)).filter((t) => {
      const negociacaoDaTarefa = t.deal_id ?? idDe(t.deal ?? null);
      return !negociacaoDaTarefa || negociacaoDaTarefa === id;
    });
    if (existentes.some((t) => (t.subject ?? '').trim() === assunto)) return 'já existia';

    const campanha = negociacao.campaign?.name ?? null;
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
