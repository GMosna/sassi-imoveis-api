// Testes da marcação de leads de retorno, no padrão dos outros scripts:
//   npx ts-node scripts/test-marcacao.ts
// Não acessa o CRM: usa um CRM falso em memória.
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { lerConfig, ConfigMarcacao } from '../src/marcacao/config';
import { classificar, NegociacaoResumo } from '../src/marcacao/classificador';
import {
  ApiCrm,
  Buscador,
  CampoParaGravar,
  ClienteCrm,
  ContatoCrm,
  ErroCrm,
  FunilCrm,
  NegociacaoCrm,
  NovaTarefa,
  TarefaCrm,
} from '../src/marcacao/crm.client';
import { Marcador, camposAlterados } from '../src/marcacao/marcador';
import { Registro } from '../src/marcacao/registro';
import { criadaEmPeloId, dataBR, paraFiltroCrm, prazoUtil } from '../src/marcacao/tempo';
import { ASSUNTO_DUPLICADO, ASSUNTO_RETORNO, textoDuplicado, textoRetorno } from '../src/marcacao/texto-tarefa';

let falhas = 0;
function confere(descricao: string, ok: boolean, detalhe?: unknown) {
  if (!ok) falhas++;
  console.log(`${ok ? 'OK ' : 'FAIL'} ${descricao}${!ok && detalhe !== undefined ? ` | obtido: ${JSON.stringify(detalhe)}` : ''}`);
}
const igual = (descricao: string, obtido: unknown, esperado: unknown) =>
  confere(`${descricao} = ${JSON.stringify(esperado)}`, JSON.stringify(obtido) === JSON.stringify(esperado), obtido);

// ---------------------------------------------------------------------------
console.log('--- configuração ---');
{
  const c = lerConfig({});
  igual('sem variáveis: modo', c.modo, 'desligado');
  igual('sem variáveis: problemas', c.problemas, []);
  igual('funis padrão', c.funisPermitidos.length, 4);
  igual('telefones internos padrão', c.telefonesInternos, ['5519993681809', '5519993681824', '551934044499']);
  igual('domínio interno padrão', c.dominiosInternos, ['@sassiimoveis.com.br']);
  igual('campo padrão', c.campoTipoEntrada, '6ad21923aa78e90029fa490b');

  const semToken = lerConfig({ MARCACAO_MODO: 'ativo' });
  igual('ativo sem token fica desligado', semToken.modo, 'desligado');
  confere('ativo sem token avisa o problema', semToken.problemas.some((p) => p.includes('token')));

  igual('RDCRM_TOKEN sozinho não liga a marcação', lerConfig({ MARCACAO_MODO: 'ativo', RDCRM_TOKEN: 'abc' }).modo, 'desligado');
  igual(
    'ativo com MARCACAO_RDCRM_TOKEN',
    [lerConfig({ MARCACAO_MODO: 'ativo', MARCACAO_RDCRM_TOKEN: 'b' }).modo, lerConfig({ MARCACAO_MODO: 'ativo', MARCACAO_RDCRM_TOKEN: 'b' }).token],
    ['ativo', 'b'],
  );
  igual('modo inválido fica desligado', lerConfig({ MARCACAO_MODO: 'ligado', MARCACAO_RDCRM_TOKEN: 'a' }).modo, 'desligado');
  igual('teste sem EMAILS_TESTE fica desligado', lerConfig({ MARCACAO_MODO: 'teste', MARCACAO_RDCRM_TOKEN: 'a' }).modo, 'desligado');
  igual('intervalo de 1 min é recusado', lerConfig({ MARCACAO_MODO: 'simulacao', MARCACAO_RDCRM_TOKEN: 'a', INTERVALO_MINUTOS: '1' }).modo, 'desligado');
  igual(
    'Funil de Testes em FUNIS_PERMITIDOS é recusado',
    lerConfig({ MARCACAO_MODO: 'ativo', MARCACAO_RDCRM_TOKEN: 'a', FUNIS_PERMITIDOS: '6a723eee480c33002099c27d' }).modo,
    'desligado',
  );
  igual(
    'CONTATOS_INTERNOS próprio',
    lerConfig({ CONTATOS_INTERNOS: '19 99999-0000, @Empresa.com' }).dominiosInternos.concat(
      lerConfig({ CONTATOS_INTERNOS: '19 99999-0000, @Empresa.com' }).telefonesInternos,
    ),
    ['@empresa.com', '5519999990000'],
  );
  igual('registro vai para CACHE_DIR', lerConfig({ CACHE_DIR: '/data' }).arquivoRegistro, path.join('/data', 'marcacao-registro.json'));
}

// ---------------------------------------------------------------------------
console.log('\n--- datas e prazo em horas úteis (São Paulo, seg a sex, 8h às 18h) ---');
{
  const sp = (iso: string) => new Date(`${iso}-03:00`);
  igual('seg 10h00 + 1h', prazoUtil(sp('2026-10-19T10:00:00')), { data: '2026-10-19', hora: '11:00' });
  igual('seg 17h00 + 1h', prazoUtil(sp('2026-10-19T17:00:00')), { data: '2026-10-19', hora: '18:00' });
  igual('seg 17h30 + 1h', prazoUtil(sp('2026-10-19T17:30:00')), { data: '2026-10-20', hora: '08:30' });
  igual('sex 17h30 + 1h', prazoUtil(sp('2026-10-23T17:30:00')), { data: '2026-10-26', hora: '08:30' });
  igual('sáb 10h00 + 1h', prazoUtil(sp('2026-10-24T10:00:00')), { data: '2026-10-26', hora: '09:00' });
  igual('dom 23h59 + 1h', prazoUtil(sp('2026-10-25T23:59:00')), { data: '2026-10-26', hora: '09:00' });
  igual('seg 07h00 + 1h', prazoUtil(sp('2026-10-19T07:00:00')), { data: '2026-10-19', hora: '09:00' });
  igual('seg 18h30 + 1h', prazoUtil(sp('2026-10-19T18:30:00')), { data: '2026-10-20', hora: '09:00' });
  igual('filtro do CRM no horário de SP', paraFiltroCrm(new Date('2026-10-19T13:00:00Z')), '2026-10-19T10:00:00');
  igual('data BR no fuso de SP', dataBR('2026-10-17T02:30:00Z'), '16/10/2026');
  igual('criação pelo ID do campo Tipo de entrada', dataBR(criadaEmPeloId('6ad21923aa78e90029fa490b')?.toISOString()), '16/10/2026');
  igual('ID fora do formato', criadaEmPeloId('abc'), null);
}

// ---------------------------------------------------------------------------
console.log('\n--- classificação ---');
{
  const r = (id: string, criadaEm: string, aberta: boolean, funilId: string | null): NegociacaoResumo => ({
    id, criadaEm, aberta, pausada: false, ganhou: aberta ? null : false, fechadaEm: aberta ? null : criadaEm,
    motivoPerda: null, funilId, funilNome: null, etapaNome: null, responsavelId: null, responsavelNome: null,
    atualizadaEm: null, detalhada: true,
  });
  const nova = { id: 'N', criadaEm: '2026-10-19T12:00:00Z' };
  const permitidos = new Set(['LB', 'VT']);
  igual('sem outras: Novo', classificar(nova, [], permitidos).tipo, 'Novo');
  igual('anterior fechada: Retorno', classificar(nova, [r('A', '2026-08-01T12:00:00Z', false, 'LB')], permitidos).tipo, 'Retorno');
  igual('anterior aberta em funil permitido: Possível duplicado', classificar(nova, [r('A', '2026-10-18T12:00:00Z', true, 'VT')], permitidos).tipo, 'Possível duplicado');
  igual('anterior aberta fora dos funis: Retorno', classificar(nova, [r('A', '2026-10-18T12:00:00Z', true, 'CL')], permitidos).tipo, 'Retorno');
  igual('só posterior: Novo', classificar(nova, [r('A', '2026-10-19T13:00:00Z', true, 'LB')], permitidos).tipo, 'Novo');
  igual('ela mesma não conta', classificar(nova, [r('N', '2026-10-18T12:00:00Z', true, 'LB')], permitidos).tipo, 'Novo');
  const c = classificar(nova, [r('A', '2026-01-01T00:00:00Z', false, 'LB'), r('B', '2026-09-01T00:00:00Z', false, 'VT')], permitidos);
  igual('anteriores da mais recente para a mais antiga', c.anteriores.map((a) => a.id), ['B', 'A']);
}

// ---------------------------------------------------------------------------
console.log('\n--- textos das tarefas ---');
{
  const anterior: NegociacaoResumo = {
    id: 'A', criadaEm: '2026-08-01T15:00:00Z', aberta: false, pausada: false, ganhou: false,
    fechadaEm: '2026-08-10T15:00:00Z', motivoPerda: 'Sem retorno', funilId: 'LB', funilNome: 'Locação - Beta',
    etapaNome: 'Atendimento', responsavelId: 'U', responsavelNome: 'Corretor Um', atualizadaEm: '2026-08-10T15:00:00Z', detalhada: true,
  };
  const t1 = textoRetorno([anterior], null);
  confere('retorno traz o funil, a data e o motivo', t1.includes('- Locação - Beta, criada em 01/08/2026: perdida em 10/08/2026 (motivo: Sem retorno). Responsável: Corretor Um.'), t1);
  confere('retorno sem campanha: ainda não informada', t1.includes('Campanha atual: ainda não informada'));
  confere('retorno com campanha', textoRetorno([anterior], 'Google Ads').includes('Campanha atual: Google Ads'));
  const muitas = Array.from({ length: 7 }, (_, i) => ({ ...anterior, id: `A${i}` }));
  confere('lista limita em 5 e resume o resto', textoRetorno(muitas, null).includes('- e mais 2 negociações anteriores.'));
  const aberta = { ...anterior, aberta: true, ganhou: null, fechadaEm: null, atualizadaEm: '2026-10-18T17:30:00Z' };
  const t2 = textoDuplicado([aberta], 'Meta');
  confere('duplicado traz responsável, etapa e última atualização', t2.includes('- Locação - Beta, etapa Atendimento. Responsável: Corretor Um. Última atualização: 18/10/2026 às 14:30.'), t2);
}

// ---------------------------------------------------------------------------
console.log('\n--- campos alterados ---');
{
  igual('nada mudou', camposAlterados([{ custom_field_id: 'X', value: 'A' }], [{ custom_field_id: 'X', value: 'A' }, { custom_field_id: 'T', value: 'Novo' }]), []);
  igual('campo sumiu', camposAlterados([{ custom_field_id: 'X', value: 'A' }], [{ custom_field_id: 'T', value: 'Novo' }]), ['X']);
  igual('campo vazio antes não conta', camposAlterados([{ custom_field_id: 'X', value: null }], []), []);
  igual('lista com mesma ordem', camposAlterados([{ custom_field_id: 'X', value: ['a', 'b'] }], [{ custom_field_id: 'X', value: ['a', 'b'] }]), []);
}

// ---------------------------------------------------------------------------
// CRM falso em memória

const LB = '66eaadbee736e20026d75b62';
const VT = '65024237f7a7d8000d3065ad';
const CL = '67e15fef2d534800144d065a';
const FT = '6a723eee480c33002099c27d';
const ETAPA: Record<string, string> = {
  [LB]: 'aa00000000000000000000a1',
  [VT]: 'aa00000000000000000000a2',
  [CL]: 'aa00000000000000000000a3',
  [FT]: 'aa00000000000000000000a4',
};
const NOME_FUNIL: Record<string, string> = { [LB]: 'Locação - Beta', [VT]: 'Venda - Terceiros', [CL]: 'Captação - Locação', [FT]: 'Funil de Testes' };
const U1 = 'bb00000000000000000000b1';
const U2 = 'bb00000000000000000000b2';
const NOME_USUARIO: Record<string, string> = { [U1]: 'Corretor Um', [U2]: 'Corretor Dois' };
const CAMPO = '6ad21923aa78e90029fa490b';
const BAIRRO = '66fa88ee192f7f0014d62082';
const MOTIVO = 'cc00000000000000000000c1';

const AGORA = new Date('2026-10-19T17:00:00Z'); // segunda, 14h em São Paulo
const minAtras = (m: number) => new Date(AGORA.getTime() - m * 60_000);
const diasAtras = (d: number) => new Date(AGORA.getTime() - d * 86_400_000);
let contador = 0;
const oid = (quando: Date) =>
  Math.floor(quando.getTime() / 1000).toString(16).padStart(8, '0') + (++contador).toString(16).padStart(16, '0');
const digitos = (s: string) => s.replace(/\D/g, '');
const copia = <T>(x: T): T => JSON.parse(JSON.stringify(x));

interface ContatoFalso {
  id: string;
  phones: { phone: string }[];
  emails: { email: string }[];
  negociacoes: string[];
}

class CrmFalso implements ApiCrm {
  chamadas = 0;
  obterChamados: string[] = [];
  buscasTelefone: string[] = [];
  buscasEmail: string[] = [];
  puts: { id: string; campos: CampoParaGravar[] }[] = [];
  tarefas: (NovaTarefa | { deal_id: string; subject: string })[] = [];
  negociacoes = new Map<string, NegociacaoCrm>();
  contatos: ContatoFalso[] = [];
  modoPut: 'mescla' | 'substitui' = 'mescla';
  falharObter = new Set<string>();
  fecharAoReler = new Set<string>();
  /** Negociação que aparece em outro funil quando é relida. */
  moverAoReler = new Map<string, string>();
  /**
   * PUT com problema: 'antes' = falha de rede sem gravar; 'depois' = grava e
   * falha (como um timeout); 'rejeita' = HTTP 422 sem gravar; 'ignora' =
   * responde OK sem guardar o valor; 'ilegivel' = grava e responde HTTP 200
   * com uma resposta que não dá para ler.
   */
  falharPut: 'antes' | 'depois' | 'rejeita' | 'ignora' | 'ilegivel' | null = null;
  /** Depois de um PUT nesta negociação, a releitura falha. */
  falharObterDepoisDoPut = new Set<string>();
  /** POST da tarefa cria e depois falha, uma vez, para estas negociações. */
  falharTarefaDepoisPara = new Set<string>();
  /** Simula um CRM que ignora os filtros ou não informa a negociação da tarefa. */
  listaIgnoraData = false;
  duplicarLista = false;
  buscaIgnoraFiltro = false;
  tarefasIgnoraFiltro = false;
  tarefasSemNegociacao = false;
  private tentadas = new Set<string>();

  /** A negociação passa para outro funil de vez (lista e releitura). */
  moverDeVez(id: string, funil: string) {
    const d = this.negociacoes.get(id) as NegociacaoCrm;
    d.deal_pipeline = { id: funil, name: NOME_FUNIL[funil] };
    d.deal_stage = { id: ETAPA[funil], name: 'Atendimento' };
    this.moverAoReler.delete(id);
  }

  novaNegociacao(funil: string, quando: Date, extra: Partial<NegociacaoCrm> = {}): string {
    const id = oid(quando);
    this.negociacoes.set(id, {
      id, _id: id, created_at: quando.toISOString(), updated_at: quando.toISOString(), closed_at: null, win: null, hold: null,
      deal_stage: { id: ETAPA[funil], name: 'Atendimento' }, deal_pipeline: { id: funil, name: NOME_FUNIL[funil] },
      user: { id: U1, name: NOME_USUARIO[U1] }, campaign: null,
      deal_custom_fields: [{ custom_field_id: BAIRRO, value: 'Centro' }],
      ...extra,
    });
    return id;
  }

  fechar(id: string, ganhou: boolean, quando: Date) {
    const d = this.negociacoes.get(id) as NegociacaoCrm;
    d.win = ganhou;
    d.closed_at = quando.toISOString();
    if (!ganhou) d.deal_lost_reason_id = MOTIVO;
  }

  novoContato(negociacoes: string[], telefone?: string, email?: string) {
    this.contatos.push({
      id: oid(AGORA), negociacoes,
      phones: telefone ? [{ phone: telefone }] : [],
      emails: email ? [{ email }] : [],
    });
  }

  private paraBusca(c: ContatoFalso): ContatoCrm {
    return {
      id: c.id, phones: c.phones, emails: c.emails,
      deals: c.negociacoes.map((id) => {
        const d = this.negociacoes.get(id) as NegociacaoCrm;
        return { id, closed_at: d.closed_at, win: d.win, deal_lost_reason_id: d.deal_lost_reason_id ?? null };
      }),
    };
  }

  async listarFunis(): Promise<FunilCrm[]> {
    this.chamadas++;
    return Object.keys(ETAPA).map((id) => ({ id, name: NOME_FUNIL[id], deal_stages: [{ id: ETAPA[id], name: 'Atendimento' }] }));
  }
  async listarMotivosPerda() {
    this.chamadas++;
    return [{ id: MOTIVO, nome: 'Sem retorno' }];
  }
  async listarNegociacoesCriadasEntre(inicio: Date, fim: Date): Promise<NegociacaoCrm[]> {
    this.chamadas++;
    const lista = [...this.negociacoes.values()]
      .filter((d) => {
        if (this.listaIgnoraData) return true;
        const t = Date.parse(d.created_at as string);
        return t >= inicio.getTime() && t <= fim.getTime();
      })
      .map((d) => {
        // A lista do CRM não traz o funil nem o ID dos contatos
        const { deal_pipeline, ...semFunil } = copia(d);
        void deal_pipeline;
        const contatos = this.contatos.filter((c) => c.negociacoes.includes(d.id as string));
        return { ...semFunil, contacts: contatos.map((c) => ({ phones: c.phones, emails: c.emails })) };
      });
    return this.duplicarLista ? [...lista, ...copia(lista)] : lista;
  }
  async obterNegociacao(id: string): Promise<NegociacaoCrm> {
    this.chamadas++;
    this.obterChamados.push(id);
    if (this.falharObter.has(id)) throw new Error('falha simulada do CRM');
    if (this.tentadas.has(id) && this.falharObterDepoisDoPut.has(id)) throw new Error('falha simulada depois do PUT');
    const d = this.negociacoes.get(id);
    if (!d) throw new Error('negociação inexistente');
    const c = copia(d);
    if (this.fecharAoReler.has(id)) {
      c.win = false;
      c.closed_at = AGORA.toISOString();
    }
    const outroFunil = this.moverAoReler.get(id);
    if (outroFunil) {
      c.deal_pipeline = { id: outroFunil, name: NOME_FUNIL[outroFunil] };
      c.deal_stage = { id: ETAPA[outroFunil], name: 'Atendimento' };
    }
    return c;
  }
  async contatosDaNegociacao(id: string): Promise<ContatoCrm[]> {
    this.chamadas++;
    return this.contatos.filter((c) => c.negociacoes.includes(id)).map((c) => this.paraBusca(c));
  }
  async buscarContatosPorTelefone(telefone: string): Promise<ContatoCrm[]> {
    this.chamadas++;
    this.buscasTelefone.push(telefone);
    // Como o CRM real: compara só dígitos e acha o número dentro do gravado
    return this.contatos
      .filter((c) => this.buscaIgnoraFiltro || c.phones.some((p) => digitos(p.phone).includes(telefone)))
      .map((c) => this.paraBusca(c));
  }
  async buscarContatosPorEmail(email: string): Promise<ContatoCrm[]> {
    this.chamadas++;
    this.buscasEmail.push(email);
    return this.contatos
      .filter((c) => c.emails.some((e) => e.email.toLowerCase() === email.toLowerCase()))
      .map((c) => this.paraBusca(c));
  }
  async tarefasDaNegociacao(id: string): Promise<TarefaCrm[]> {
    this.chamadas++;
    return this.tarefas
      .filter((t) => this.tarefasIgnoraFiltro || t.deal_id === id)
      .map((t) => (this.tarefasSemNegociacao ? { subject: t.subject } : { subject: t.subject, deal_id: t.deal_id }));
  }
  async atualizarCamposPersonalizados(id: string, campos: CampoParaGravar[]): Promise<void> {
    this.chamadas++;
    this.puts.push({ id, campos: copia(campos) });
    this.tentadas.add(id);
    if (this.falharPut === 'antes') throw new Error('falha simulada no PUT');
    if (this.falharPut === 'rejeita') throw new ErroCrm(`PUT /deals/${id}: o CRM respondeu HTTP 422`, 422);
    if (this.falharPut === 'ignora') return;
    const d = this.negociacoes.get(id) as NegociacaoCrm;
    if (this.modoPut === 'substitui') {
      d.deal_custom_fields = campos.map((c) => ({ custom_field_id: c.custom_field_id, value: c.value }));
    } else {
      const lista = d.deal_custom_fields ?? [];
      for (const c of campos) {
        const existente = lista.find((x) => x.custom_field_id === c.custom_field_id);
        if (existente) existente.value = c.value;
        else lista.push({ custom_field_id: c.custom_field_id, value: c.value });
      }
      d.deal_custom_fields = lista;
    }
    if (this.falharPut === 'depois') throw new Error('falha simulada depois de gravar (timeout)');
    if (this.falharPut === 'ilegivel') throw new ErroCrm(`PUT /deals/${id}: resposta do CRM incompleta`, 200);
  }
  async criarTarefa(tarefa: NovaTarefa): Promise<void> {
    this.chamadas++;
    this.tarefas.push(copia(tarefa));
    if (this.falharTarefaDepoisPara.delete(tarefa.deal_id)) throw new Error('falha simulada depois de criar a tarefa');
  }
}

interface Cenario {
  crm: CrmFalso;
  ids: Record<string, string>;
}

/** Monta o mesmo conjunto de negociações para cada teste. */
function montarCenario(): Cenario {
  const crm = new CrmFalso();
  const ids: Record<string, string> = {};

  // N1: contato sem nenhuma outra negociação -> Novo
  ids.N1 = crm.novaNegociacao(LB, minAtras(30));
  crm.novoContato([ids.N1], '+5519991110001', 'n1@exemplo.com');

  // N2: mesmo cadastro já teve negociação perdida -> Retorno
  ids.P2 = crm.novaNegociacao(LB, diasAtras(60));
  crm.fechar(ids.P2, false, diasAtras(50));
  ids.N2 = crm.novaNegociacao(LB, minAtras(30), { campaign: { id: 'k1', name: 'Google Ads Locação' } });
  crm.novoContato([ids.P2, ids.N2], '(19) 99111-0002');

  // N3: outro cadastro com o mesmo e-mail tem negociação aberta em funil permitido -> Possível duplicado
  ids.P3 = crm.novaNegociacao(LB, diasAtras(2), { user: { id: U2, name: NOME_USUARIO[U2] } });
  ids.N3 = crm.novaNegociacao(VT, minAtras(28));
  crm.novoContato([ids.N3], undefined, 'x3@exemplo.com');
  crm.novoContato([ids.P3], undefined, 'X3@Exemplo.com');

  // N4: criada há 5 min, ainda dentro da espera da roleta
  ids.N4 = crm.novaNegociacao(LB, minAtras(5));
  crm.novoContato([ids.N4], '19991110004');

  // N5: funil fora da marcação
  ids.N5 = crm.novaNegociacao(CL, minAtras(30));
  crm.novoContato([ids.N5], '19991110005');

  // N6: telefone interno da Sassi, que tem outras negociações -> não busca -> Novo
  ids.P6 = crm.novaNegociacao(LB, diasAtras(30));
  crm.fechar(ids.P6, true, diasAtras(20));
  ids.N6 = crm.novaNegociacao(LB, minAtras(40));
  crm.novoContato([ids.N6], '(19) 99368-1809');
  crm.novoContato([ids.P6], '5519993681809');

  // N7: anterior aberta num funil fora da marcação -> Retorno
  ids.P7 = crm.novaNegociacao(CL, diasAtras(10));
  ids.N7 = crm.novaNegociacao(LB, minAtras(35));
  crm.novoContato([ids.P7, ids.N7], '19991110007');

  // N8 e P8: mesmo cadastro, P8 criada depois -> N8 Novo, P8 Possível duplicado
  ids.N8 = crm.novaNegociacao(LB, minAtras(45));
  ids.P8 = crm.novaNegociacao(LB, minAtras(20), { user: { id: U2, name: NOME_USUARIO[U2] } });
  crm.novoContato([ids.N8, ids.P8], '5519991110008');

  // N9: perdida entre a lista e a gravação -> não grava nada
  ids.P9 = crm.novaNegociacao(LB, diasAtras(90));
  crm.fechar(ids.P9, false, diasAtras(80));
  ids.N9 = crm.novaNegociacao(LB, minAtras(50));
  crm.novoContato([ids.P9, ids.N9], '19991110009');
  crm.fecharAoReler.add(ids.N9);

  // N10: alguém marcou "Novo" à mão, mas é retorno -> mantém o valor e cria a tarefa
  ids.P10 = crm.novaNegociacao(VT, diasAtras(100));
  crm.fechar(ids.P10, false, diasAtras(95));
  ids.N10 = crm.novaNegociacao(LB, minAtras(55), {
    deal_custom_fields: [{ custom_field_id: BAIRRO, value: 'Centro' }, { custom_field_id: CAMPO, value: 'Novo' }],
  });
  crm.novoContato([ids.P10, ids.N10], '19991110010');

  // N11: retorno que já tem a tarefa -> grava o campo e não duplica a tarefa
  ids.P11 = crm.novaNegociacao(LB, diasAtras(40));
  crm.fechar(ids.P11, false, diasAtras(35));
  ids.N11 = crm.novaNegociacao(LB, minAtras(60));
  crm.novoContato([ids.P11, ids.N11], '19991110011');
  crm.tarefas.push({ deal_id: ids.N11, subject: ASSUNTO_RETORNO });

  return { crm, ids };
}

const logs: string[] = [];
const log = {
  info: (m: string) => logs.push(`info: ${m}`),
  aviso: (m: string) => logs.push(`aviso: ${m}`),
  erro: (m: string) => logs.push(`erro: ${m}`),
};

async function novoRegistro(): Promise<Registro> {
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'marcacao-'));
  return new Registro(path.join(pasta, 'registro.json'));
}

function config(env: Record<string, string>): ConfigMarcacao {
  const c = lerConfig({ MARCACAO_RDCRM_TOKEN: 'token-falso', ...env });
  if (c.problemas.length) throw new Error(`config de teste inválida: ${c.problemas.join('; ')}`);
  return c;
}

const tiposPorId = (registro: Registro, ids: Record<string, string>) => {
  const porId = new Map(registro.ultimas(200).map((d) => [d.negociacao, d]));
  const resultado: Record<string, string> = {};
  for (const [nome, id] of Object.entries(ids)) {
    const d = porId.get(id);
    if (d) resultado[nome] = `${d.tipo}/${d.acao}`;
  }
  return resultado;
};

async function testes() {
  // -------------------------------------------------------------------------
  console.log('\n--- rodada em modo simulação: não grava nada ---');
  {
    const { crm, ids } = montarCenario();
    const registro = await novoRegistro();
    const m = new Marcador(config({ MARCACAO_MODO: 'simulacao' }), crm, registro, log, () => AGORA);
    const r = await m.rodada();
    igual('nenhum campo gravado', crm.puts.length, 0);
    igual('nenhuma tarefa criada', crm.tarefas.length, 1); // só a que já existia em N11
    igual('processadas', r.processadas, 10);
    igual('aguardando a roleta', r.aguardando, 1);
    igual('tipos calculados', tiposPorId(registro, ids), {
      N1: 'Novo/simulou', N2: 'Retorno/simulou', N3: 'Possível duplicado/simulou', N6: 'Novo/simulou',
      N7: 'Retorno/simulou', N8: 'Novo/simulou', P8: 'Possível duplicado/simulou', N9: 'Retorno/simulou',
      N10: 'Retorno/simulou', N11: 'Retorno/simulou',
    });
    igual('em simulação só abre as anteriores abertas', [...crm.obterChamados].sort(), [ids.P3, ids.P7, ids.N8].sort());
    confere('não buscou o telefone interno', !crm.buscasTelefone.includes('19993681809'), crm.buscasTelefone);
    confere('buscou o telefone sem o 55', crm.buscasTelefone.includes('19991110002') && crm.buscasTelefone.includes('19991110008'), crm.buscasTelefone);
    confere('e-mail buscado em minúsculas', crm.buscasEmail.includes('x3@exemplo.com'), crm.buscasEmail);
    const de4 = registro.ultimas(200).find((d) => d.negociacao === ids.N4);
    igual('N4 fica para a próxima rodada', de4, undefined);
    const de5 = registro.ultimas(200).find((d) => d.negociacao === ids.N5);
    igual('N5 (funil fora da marcação) é ignorada', de5, undefined);

    const r2 = await m.rodada();
    igual('segunda rodada não reprocessa', r2.processadas, 0);
  }

  // -------------------------------------------------------------------------
  console.log('\n--- rodada em modo ativo ---');
  {
    const { crm, ids } = montarCenario();
    const registro = await novoRegistro();
    const m = new Marcador(config({ MARCACAO_MODO: 'ativo' }), crm, registro, log, () => AGORA);
    const r = await m.rodada();
    igual('processadas', r.processadas, 10);

    const gravado = (nome: string) => crm.puts.filter((p) => p.id === ids[nome]).map((p) => p.campos);
    igual('N1 grava Novo e só o campo dela', gravado('N1'), [[{ custom_field_id: CAMPO, value: 'Novo' }]]);
    igual('N2 grava Retorno', gravado('N2'), [[{ custom_field_id: CAMPO, value: 'Retorno' }]]);
    igual('N3 grava Possível duplicado', gravado('N3'), [[{ custom_field_id: CAMPO, value: 'Possível duplicado' }]]);
    igual('N9 perdida antes: não grava', gravado('N9'), []);
    igual('N10 preenchida à mão: não troca', gravado('N10'), []);
    igual('total de campos gravados', crm.puts.length, 8);
    igual('Bairro de N2 continua igual', (crm.negociacoes.get(ids.N2)?.deal_custom_fields ?? []).find((c) => c.custom_field_id === BAIRRO)?.value, 'Centro');

    const tarefas = (nome: string) => crm.tarefas.filter((t) => t.deal_id === ids[nome]) as NovaTarefa[];
    igual('N1 (Novo) sem tarefa', tarefas('N1').length, 0);
    igual('N2: assunto', tarefas('N2').map((t) => t.subject), [ASSUNTO_RETORNO]);
    igual('N2: responsável e prazo de 1 hora útil', tarefas('N2').map((t) => [t.user_ids, t.date, t.hour, t.type, t.done]), [[[U1], '2026-10-19', '15:00', 'task', false]]);
    confere('N2: texto com a anterior perdida e a campanha', (tarefas('N2')[0]?.notes ?? '').includes('perdida em') && (tarefas('N2')[0]?.notes ?? '').includes('(motivo: Sem retorno)') && (tarefas('N2')[0]?.notes ?? '').includes('Campanha atual: Google Ads Locação'), tarefas('N2')[0]?.notes);
    igual('N3: tarefa para os dois responsáveis', tarefas('N3').map((t) => [t.subject, t.user_ids]), [[ASSUNTO_DUPLICADO, [U1, U2]]]);
    confere('N3: texto com o outro responsável', (tarefas('N3')[0]?.notes ?? '').includes('Responsável: Corretor Dois.'), tarefas('N3')[0]?.notes);
    confere('N7: retorno com anterior aberta fora dos funis', (tarefas('N7')[0]?.notes ?? '').includes('Captação - Locação') && (tarefas('N7')[0]?.notes ?? '').includes('em andamento'), tarefas('N7')[0]?.notes);
    igual('P8: duplicado com a N8, para os dois', tarefas('P8').map((t) => [t.subject, t.user_ids]), [[ASSUNTO_DUPLICADO, [U2, U1]]]);
    igual('N9: sem tarefa', tarefas('N9').length, 0);
    igual('N10: tarefa criada mesmo com o campo à mão', tarefas('N10').map((t) => t.subject), [ASSUNTO_RETORNO]);
    igual('N11: não duplica a tarefa', tarefas('N11').length, 1);

    const decisao = (nome: string) => registro.ultimas(200).find((d) => d.negociacao === ids[nome]);
    confere('N10: registra a diferença', (decisao('N10')?.observacao ?? '').includes('campo preenchido à mão com "Novo"; a API calculou "Retorno"'), decisao('N10'));
    igual('N9: decisão', [decisao('N9')?.acao, decisao('N9')?.observacao], ['nada gravado', 'negociação ganha ou perdida antes da marcação']);
    igual('N11: decisão', [decisao('N11')?.campo, decisao('N11')?.tarefa], ['gravado', 'já existia']);

    const antes = { puts: crm.puts.length, tarefas: crm.tarefas.length };
    const r2 = await m.rodada();
    igual('segunda rodada: nada novo', [r2.processadas, crm.puts.length, crm.tarefas.length], [0, antes.puts, antes.tarefas]);

    // O registro sobrevive a um reinício
    const outro = new Registro((registro as unknown as { arquivo: string }).arquivo);
    await outro.carregar();
    igual('registro recarregado do disco', [outro.jaProcessada(ids.N2), outro.ultimas(200).length], [true, 10]);
  }

  // -------------------------------------------------------------------------
  console.log('\n--- modo teste: só grava no Funil de Testes com contato da lista ---');
  {
    const { crm, ids } = montarCenario();
    ids.TP = crm.novaNegociacao(FT, diasAtras(3));
    crm.fechar(ids.TP, false, diasAtras(2));
    ids.T1 = crm.novaNegociacao(FT, minAtras(30));
    crm.novoContato([ids.TP, ids.T1], undefined, 'teste1@sassiimoveis.com.br');
    ids.T2 = crm.novaNegociacao(FT, minAtras(30));
    crm.novoContato([ids.T2], undefined, 'qualquer@exemplo.com');
    const registro = await novoRegistro();
    const m = new Marcador(config({ MARCACAO_MODO: 'teste', EMAILS_TESTE: 'teste1@sassiimoveis.com.br' }), crm, registro, log, () => AGORA);
    await m.rodada();
    igual('só T1 recebe gravação', crm.puts.map((p) => p.id), [ids.T1]);
    igual('T1 é retorno', crm.puts[0]?.campos, [{ custom_field_id: CAMPO, value: 'Retorno' }]);
    igual('tipos', tiposPorId(registro, { T1: ids.T1, T2: ids.T2, N2: ids.N2 }), { T1: 'Retorno/gravou', T2: 'Novo/simulou', N2: 'Retorno/simulou' });
  }

  // -------------------------------------------------------------------------
  console.log('\n--- disjuntor: se o CRM apagar outros campos, para de gravar ---');
  {
    const { crm, ids } = montarCenario();
    crm.modoPut = 'substitui';
    const registro = await novoRegistro();
    logs.length = 0;
    const m = new Marcador(config({ MARCACAO_MODO: 'ativo' }), crm, registro, log, () => AGORA);
    const r = await m.rodada();
    igual('só a primeira gravação acontece', crm.puts.length, 1);
    confere('disjuntor ligado', Boolean(m.disjuntor), m.disjuntor);
    confere('log de alerta', logs.some((l) => l.startsWith('erro: ALERTA')), logs);
    igual('nenhuma negociação dada como processada', [registro.ultimas(200).length, registro.jaProcessada(ids.N11)], [0, false]);
    igual('as demais esperam a liberação', [r.suspensa, r.aguardando, r.erros], [true, 10, 1]);
    igual('nenhuma tarefa nova depois do alerta', crm.tarefas.filter((t) => t.deal_id !== ids.N11).length, 0);
    const r2 = await m.rodada();
    igual('rodada seguinte não faz nada', [r2.suspensa, r2.processadas, r2.chamadas], [true, 0, 0]);
  }

  // -------------------------------------------------------------------------
  console.log('\n--- MARCACAO_REENVIAR_CAMPOS=sim reenvia os outros campos ---');
  {
    const { crm, ids } = montarCenario();
    crm.modoPut = 'substitui';
    const registro = await novoRegistro();
    const m = new Marcador(config({ MARCACAO_MODO: 'ativo', MARCACAO_REENVIAR_CAMPOS: 'sim' }), crm, registro, log, () => AGORA);
    await m.rodada();
    igual('grava as 8 sem disjuntor', [crm.puts.length, m.disjuntor], [8, null]);
    igual('Bairro preservado', (crm.negociacoes.get(ids.N2)?.deal_custom_fields ?? []).find((c) => c.custom_field_id === BAIRRO)?.value, 'Centro');
  }

  // -------------------------------------------------------------------------
  console.log('\n--- erro do CRM numa negociação não para as outras ---');
  {
    const { crm, ids } = montarCenario();
    crm.falharObter.add(ids.P3);
    const registro = await novoRegistro();
    logs.length = 0;
    const m = new Marcador(config({ MARCACAO_MODO: 'ativo' }), crm, registro, log, () => AGORA);
    const r1 = await m.rodada();
    igual('rodada 1: 9 processadas e 1 erro', [r1.processadas, r1.erros], [9, 1]);
    igual('N3 ainda não foi marcada', registro.jaProcessada(ids.N3), false);
    const r2 = await m.rodada();
    const r3 = await m.rodada();
    igual('rodadas 2 e 3 só tentam a N3', [r2.processadas, r2.erros, r3.processadas, r3.erros], [0, 1, 0, 1]);
    const d = registro.ultimas(200).find((x) => x.negociacao === ids.N3);
    igual('depois de 3 tentativas registra o erro', [d?.acao, registro.jaProcessada(ids.N3)], ['erro', true]);
    confere('log não tem dados de contato', !logs.some((l) => /exemplo\.com|9911100/.test(l)), logs);
  }

  // -------------------------------------------------------------------------
  // Casos apontados na revisão independente
  console.log('\n--- revisão: a negociação mudou de funil entre a lista e a gravação ---');
  {
    const { crm, ids } = montarCenario();
    crm.moverAoReler.set(ids.N2, CL);
    const registro = await novoRegistro();
    const m = new Marcador(config({ MARCACAO_MODO: 'ativo' }), crm, registro, log, () => AGORA);
    await m.rodada();
    igual('N2 não é gravada nem dada como processada', [crm.puts.some((p) => p.id === ids.N2), registro.jaProcessada(ids.N2)], [false, false]);
    igual('N2 sem tarefa', crm.tarefas.filter((t) => t.deal_id === ids.N2).length, 0);
    // Foi para Captação de vez: a lista mostra o funil novo e ela sai da marcação
    crm.moverDeVez(ids.N2, CL);
    await m.rodada();
    igual('em Captação ela nunca é gravada', [crm.puts.some((p) => p.id === ids.N2), registro.jaProcessada(ids.N2)], [false, false]);
  }

  console.log('\n--- revisão: mudou entre dois funis da marcação: grava no funil novo ---');
  {
    const { crm, ids } = montarCenario();
    crm.moverAoReler.set(ids.N2, VT);
    const registro = await novoRegistro();
    const m = new Marcador(config({ MARCACAO_MODO: 'ativo' }), crm, registro, log, () => AGORA);
    await m.rodada();
    igual('rodada 1: N2 fica para depois', [crm.puts.some((p) => p.id === ids.N2), registro.jaProcessada(ids.N2)], [false, false]);
    crm.moverDeVez(ids.N2, VT);
    await m.rodada();
    const d = registro.ultimas(200).find((x) => x.negociacao === ids.N2);
    igual('rodada 2: Retorno gravado em Venda - Terceiros', [d?.tipo, d?.acao, d?.funil], ['Retorno', 'gravou', 'Venda - Terceiros']);
    igual('com a tarefa', crm.tarefas.filter((t) => t.deal_id === ids.N2).length, 1);
  }

  console.log('\n--- revisão: PUT dá erro mas grava (como um timeout) ---');
  {
    const { crm, ids } = montarCenario();
    crm.falharPut = 'depois';
    const registro = await novoRegistro();
    const m = new Marcador(config({ MARCACAO_MODO: 'ativo' }), crm, registro, log, () => AGORA);
    const r = await m.rodada();
    igual('todas processadas, sem disjuntor', [r.processadas, r.erros, m.disjuntor], [10, 0, null]);
    const d = registro.ultimas(200).find((x) => x.negociacao === ids.N2);
    confere('registra que o CRM deu erro mas gravou', (d?.observacao ?? '').includes('o CRM respondeu com erro, mas gravou'), d);
    igual('N2 ganhou a tarefa', crm.tarefas.filter((t) => t.deal_id === ids.N2).length, 1);
  }

  console.log('\n--- revisão: PUT dá erro e não grava: tenta de novo na próxima rodada ---');
  {
    const { crm, ids } = montarCenario();
    crm.falharPut = 'antes';
    const registro = await novoRegistro();
    const m = new Marcador(config({ MARCACAO_MODO: 'ativo' }), crm, registro, log, () => AGORA);
    const r1 = await m.rodada();
    igual('rodada 1: as 8 que gravariam ficam para depois', [r1.processadas, r1.erros, registro.jaProcessada(ids.N2), m.disjuntor], [2, 8, false, null]);
    crm.falharPut = null;
    const r2 = await m.rodada();
    igual('rodada 2: gravam', [r2.processadas, r2.gravadas, registro.jaProcessada(ids.N2)], [8, 8, true]);
  }

  console.log('\n--- revisão: PUT apaga outros campos e dá erro: o disjuntor liga mesmo assim ---');
  {
    const { crm, ids } = montarCenario();
    crm.modoPut = 'substitui';
    crm.falharPut = 'depois';
    const registro = await novoRegistro();
    const m = new Marcador(config({ MARCACAO_MODO: 'ativo' }), crm, registro, log, () => AGORA);
    await m.rodada();
    igual('uma gravação só e disjuntor ligado', [crm.puts.length, Boolean(m.disjuntor)], [1, true]);
    igual('nenhuma tarefa nova', crm.tarefas.filter((t) => t.deal_id !== ids.N11).length, 0);
  }

  console.log('\n--- revisão: sem como conferir depois de gravar, o disjuntor liga e fica guardado ---');
  {
    const { crm, ids } = montarCenario();
    crm.falharObterDepoisDoPut.add(ids.N11); // N11 é a primeira da rodada (a mais antiga)
    const registro = await novoRegistro();
    const m = new Marcador(config({ MARCACAO_MODO: 'ativo' }), crm, registro, log, () => AGORA);
    await m.rodada();
    igual('disjuntor ligado e N11 fica para depois', [Boolean(m.disjuntor), registro.jaProcessada(ids.N11), crm.puts.length], [true, false, 1]);
    igual('nenhuma outra dada como processada', registro.ultimas(200).length, 0);

    const arquivo = (registro as unknown as { arquivo: string }).arquivo;
    const depoisDeReiniciar = new Registro(arquivo);
    await depoisDeReiniciar.carregar();
    confere('disjuntor guardado em disco', Boolean(depoisDeReiniciar.disjuntor), depoisDeReiniciar.disjuntor);
    const m2 = new Marcador(config({ MARCACAO_MODO: 'ativo' }), crm, depoisDeReiniciar, log, () => AGORA);
    await m2.rodada();
    igual('depois de reiniciar continua sem gravar', crm.puts.length, 1);
    igual('religar libera a gravação', [await m2.religar(), m2.disjuntor], [true, null]);
    const liberado = new Registro(arquivo);
    await liberado.carregar();
    igual('liberação guardada em disco', liberado.disjuntor, null);

    // Depois de liberar, todas as negociações da janela são vistas, inclusive a N11
    crm.falharObterDepoisDoPut.clear();
    const r3 = await m2.rodada();
    igual('depois de liberar processa todas', r3.processadas, 10);
    const n11 = depoisDeReiniciar.ultimas(200).find((d) => d.negociacao === ids.N11);
    igual('N11 com o valor que já tinha gravado', [n11?.campo, n11?.tarefa], ['já preenchido', 'já existia']);
    igual('N2 ganha campo e tarefa', [crm.puts.some((p) => p.id === ids.N2), crm.tarefas.filter((t) => t.deal_id === ids.N2).length], [true, 1]);
    igual('N11 não recebe um segundo PUT', crm.puts.filter((p) => p.id === ids.N11).length, 1);
  }

  console.log('\n--- segunda revisão: recusa definitiva (HTTP 422) não repete e cria a tarefa ---');
  {
    const { crm, ids } = montarCenario();
    crm.falharPut = 'rejeita';
    const registro = await novoRegistro();
    const m = new Marcador(config({ MARCACAO_MODO: 'ativo' }), crm, registro, log, () => AGORA);
    const r1 = await m.rodada();
    const d = registro.ultimas(200).find((x) => x.negociacao === ids.N2);
    igual('todas processadas, sem disjuntor', [r1.processadas, r1.erros, m.disjuntor], [10, 0, null]);
    confere('N2: campo não gravado, com o motivo', d?.campo === 'não gravado' && (d?.observacao ?? '').includes('HTTP 422'), d);
    igual('tarefas criadas assim mesmo', ['N2', 'N3', 'N7', 'P8', 'N10'].map((n) => crm.tarefas.filter((t) => t.deal_id === ids[n]).length), [1, 1, 1, 1, 1]);
    await m.rodada();
    igual('não repete o PUT', crm.puts.length, 8);
  }

  console.log('\n--- segunda revisão: CRM aceita e não guarda o valor: não repete e cria a tarefa ---');
  {
    const { crm, ids } = montarCenario();
    crm.falharPut = 'ignora';
    const registro = await novoRegistro();
    const m = new Marcador(config({ MARCACAO_MODO: 'ativo' }), crm, registro, log, () => AGORA);
    await m.rodada();
    await m.rodada();
    const d = registro.ultimas(200).find((x) => x.negociacao === ids.N2);
    igual('N2', [d?.campo, d?.tarefa, d?.observacao], ['não gravado', 'criada', 'o CRM aceitou, mas não mostrou o valor gravado']);
    igual('um PUT por negociação', crm.puts.length, 8);
  }

  console.log('\n--- segunda revisão: recusa definitiva e releitura falha: sem disjuntor ---');
  {
    const { crm, ids } = montarCenario();
    crm.falharPut = 'rejeita';
    crm.falharObterDepoisDoPut.add(ids.N11);
    const registro = await novoRegistro();
    const m = new Marcador(config({ MARCACAO_MODO: 'ativo' }), crm, registro, log, () => AGORA);
    const r = await m.rodada();
    igual('disjuntor desligado, N11 fica para depois, as outras seguem', [m.disjuntor, registro.jaProcessada(ids.N11), r.processadas], [null, false, 9]);
  }

  console.log('\n--- segunda revisão: tarefa sem a negociação informada e POST que cria e falha ---');
  {
    const { crm, ids } = montarCenario();
    crm.tarefasSemNegociacao = true;
    crm.falharTarefaDepoisPara.add(ids.N2);
    const registro = await novoRegistro();
    const m = new Marcador(config({ MARCACAO_MODO: 'ativo' }), crm, registro, log, () => AGORA);
    const r1 = await m.rodada();
    igual('rodada 1: N2 fica para depois', [r1.erros, registro.jaProcessada(ids.N2)], [1, false]);
    await m.rodada();
    const d = registro.ultimas(200).find((x) => x.negociacao === ids.N2);
    igual('rodada 2: reconhece a tarefa já criada', [d?.campo, d?.tarefa], ['já preenchido', 'já existia']);
    igual('N2 com uma tarefa só', crm.tarefas.filter((t) => t.deal_id === ids.N2).length, 1);
  }

  console.log('\n--- terceira revisão: PUT grava, apaga outros campos, resposta ilegível e releitura falha: disjuntor ---');
  {
    const { crm, ids } = montarCenario();
    crm.modoPut = 'substitui';
    crm.falharPut = 'ilegivel';
    crm.falharObterDepoisDoPut.add(ids.N11); // N11 é a primeira da rodada
    const registro = await novoRegistro();
    const m = new Marcador(config({ MARCACAO_MODO: 'ativo' }), crm, registro, log, () => AGORA);
    await m.rodada();
    igual(
      'disjuntor ligado, N11 fica para depois, uma gravação só',
      [Boolean(m.disjuntor), registro.jaProcessada(ids.N11), crm.puts.length],
      [true, false, 1],
    );
  }

  console.log('\n--- terceira revisão: resposta ilegível, mas gravou: confere e segue ---');
  {
    const { crm, ids } = montarCenario();
    crm.falharPut = 'ilegivel';
    const registro = await novoRegistro();
    const m = new Marcador(config({ MARCACAO_MODO: 'ativo' }), crm, registro, log, () => AGORA);
    const r = await m.rodada();
    const d = registro.ultimas(200).find((x) => x.negociacao === ids.N2);
    igual('todas processadas, sem disjuntor', [r.processadas, r.erros, m.disjuntor], [10, 0, null]);
    igual(
      'N2 gravada, com a observação',
      [d?.campo, (d?.observacao ?? '').includes('o CRM respondeu com erro, mas gravou')],
      ['gravado', true],
    );
  }

  console.log('\n--- terceira revisão: o disjuntor não conta como tentativa ---');
  {
    const { crm, ids } = montarCenario();
    crm.falharObter.add(ids.N11);
    const registro = await novoRegistro();
    const m = new Marcador(config({ MARCACAO_MODO: 'ativo' }), crm, registro, log, () => AGORA);
    await m.rodada();
    await m.rodada();
    igual('N11 falhou duas vezes e continua pendente', registro.jaProcessada(ids.N11), false);
    crm.falharObter.delete(ids.N11);
    crm.modoPut = 'substitui';
    await m.rodada();
    igual(
      'na terceira, o disjuntor liga e N11 não é dada como desistida',
      [Boolean(m.disjuntor), registro.jaProcessada(ids.N11), registro.ultimas(200).some((x) => x.negociacao === ids.N11)],
      [true, false, false],
    );
    crm.modoPut = 'mescla';
    await m.religar();
    await m.rodada();
    const n11 = registro.ultimas(200).find((x) => x.negociacao === ids.N11);
    igual(
      'depois de liberar, N11 é processada sem novo PUT',
      [n11?.campo, n11?.tarefa, crm.puts.filter((p) => p.id === ids.N11).length],
      ['já preenchido', 'já existia', 1],
    );
  }

  console.log('\n--- revisão: o CRM ignora o filtro de data ---');
  {
    const { crm, ids } = montarCenario();
    crm.listaIgnoraData = true;
    const registro = await novoRegistro();
    const m = new Marcador(config({ MARCACAO_MODO: 'ativo' }), crm, registro, log, () => AGORA);
    const r = await m.rodada();
    igual('só as das últimas 24 h', [r.processadas, registro.jaProcessada(ids.P2), crm.puts.some((p) => p.id === ids.P2)], [10, false, false]);
  }

  console.log('\n--- revisão: a lista repete a mesma negociação ---');
  {
    const { crm } = montarCenario();
    crm.duplicarLista = true;
    const registro = await novoRegistro();
    const m = new Marcador(config({ MARCACAO_MODO: 'ativo' }), crm, registro, log, () => AGORA);
    const r = await m.rodada();
    igual('cada uma processada uma vez', [r.processadas, crm.puts.length], [10, 8]);
  }

  console.log('\n--- revisão: o CRM devolve cadastros sem o telefone buscado ---');
  {
    const { crm, ids } = montarCenario();
    crm.buscaIgnoraFiltro = true;
    const registro = await novoRegistro();
    const m = new Marcador(config({ MARCACAO_MODO: 'simulacao' }), crm, registro, log, () => AGORA);
    await m.rodada();
    igual(
      'tipos iguais aos de um CRM que filtra',
      tiposPorId(registro, { N1: ids.N1, N2: ids.N2, N6: ids.N6, N8: ids.N8, P8: ids.P8 }),
      { N1: 'Novo/simulou', N2: 'Retorno/simulou', N6: 'Novo/simulou', N8: 'Novo/simulou', P8: 'Possível duplicado/simulou' },
    );
  }

  console.log('\n--- revisão: tarefa de outra negociação com o mesmo assunto não conta ---');
  {
    const { crm, ids } = montarCenario();
    crm.tarefasIgnoraFiltro = true;
    const registro = await novoRegistro();
    const m = new Marcador(config({ MARCACAO_MODO: 'ativo' }), crm, registro, log, () => AGORA);
    await m.rodada();
    igual('N2 ganha a tarefa mesmo com a da N11 na lista', crm.tarefas.filter((t) => t.deal_id === ids.N2).length, 1);
    igual('N11 continua com uma só', crm.tarefas.filter((t) => t.deal_id === ids.N11).length, 1);
  }

  console.log('\n--- revisão: anterior aberta mais antiga que 10 fechadas ---');
  {
    const crm = new CrmFalso();
    const aberta = crm.novaNegociacao(VT, diasAtras(200), { user: { id: U2, name: NOME_USUARIO[U2] } });
    const fechadas = Array.from({ length: 11 }, (_, i) => {
      const id = crm.novaNegociacao(LB, diasAtras(150 - i * 10));
      crm.fechar(id, false, diasAtras(149 - i * 10));
      return id;
    });
    const nova = crm.novaNegociacao(LB, minAtras(30));
    crm.novoContato([aberta, ...fechadas, nova], '19991119999');
    const registro = await novoRegistro();
    const m = new Marcador(config({ MARCACAO_MODO: 'ativo' }), crm, registro, log, () => AGORA);
    await m.rodada();
    igual('continua Possível duplicado', tiposPorId(registro, { nova }), { nova: 'Possível duplicado/gravou' });
    igual('tarefa para os dois', (crm.tarefas.find((t) => t.deal_id === nova) as NovaTarefa | undefined)?.user_ids, [U1, U2]);
  }

  console.log('\n--- revisão: lead de teste não vira tarefa para responsável real ---');
  {
    const crm = new CrmFalso();
    const real = crm.novaNegociacao(LB, diasAtras(5), { user: { id: U2, name: NOME_USUARIO[U2] } });
    const teste = crm.novaNegociacao(FT, minAtras(30));
    crm.novoContato([real, teste], '19991118888', 'teste1@sassiimoveis.com.br');
    const registro = await novoRegistro();
    const m = new Marcador(config({ MARCACAO_MODO: 'teste', EMAILS_TESTE: 'teste1@sassiimoveis.com.br' }), crm, registro, log, () => AGORA);
    await m.rodada();
    igual('vira Retorno, não Possível duplicado', tiposPorId(registro, { teste }), { teste: 'Retorno/gravou' });
    igual('tarefa só para o responsável do teste', (crm.tarefas.find((t) => t.deal_id === teste) as NovaTarefa | undefined)?.user_ids, [U1]);
    igual('negociação real intocada', crm.puts.some((p) => p.id === real), false);
  }

  console.log('\n--- revisão: telefone gigante não trava a API e telefone com texto é lido ---');
  {
    const crm = new CrmFalso();
    const comEspacos = crm.novaNegociacao(LB, minAtras(30));
    crm.novoContato([comEspacos], ' '.repeat(5000) + '19991117777');
    const semEspacos = crm.novaNegociacao(LB, minAtras(31));
    crm.novoContato([semEspacos], '1-'.repeat(3000));
    const comRecado = crm.novaNegociacao(LB, minAtras(32));
    crm.novoContato([comRecado], '(19) 99111-5555 / (19) 3404-0000 recado Maria');
    const anterior = crm.novaNegociacao(LB, diasAtras(30));
    crm.fechar(anterior, false, diasAtras(25));
    crm.novoContato([anterior], 'cel (19) 99111-5555 ou fixo (19) 3404-0000, falar com a Maria depois das 18h');
    const registro = await novoRegistro();
    const m = new Marcador(config({ MARCACAO_MODO: 'simulacao' }), crm, registro, log, () => AGORA);
    const inicio = Date.now();
    await m.rodada();
    const ms = Date.now() - inicio;
    confere(`rodada rápida (${ms} ms)`, ms < 500, ms);
    igual('busca os telefones de verdade', [...crm.buscasTelefone].sort(), ['19991115555', '19991117777']);
    igual('telefone com recado acha a anterior', tiposPorId(registro, { comRecado }), { comRecado: 'Retorno/simulou' });
  }

  console.log('\n--- segunda revisão: registro em disco ---');
  {
    const pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'marcacao-registro-'));
    const arquivo = path.join(pasta, 'registro.json');
    const r = new Registro(arquivo);
    r.marcarProcessada('d1', AGORA);
    await Promise.all([r.salvar(), r.salvar(), r.salvar(), r.salvar(), r.salvar()]);
    const lido = JSON.parse(await fs.readFile(arquivo, 'utf-8'));
    igual('5 gravações seguidas deixam o arquivo inteiro', lido.processadas.length, 1);

    const semArquivo = new Registro(path.join(pasta, 'nao-existe.json'));
    await semArquivo.carregar();
    igual('sem arquivo: começa vazio e gravando', semArquivo.disjuntor, null);

    await fs.writeFile(arquivo, '{"processadas": [', 'utf-8');
    const avisos: string[] = [];
    const corrompido = new Registro(arquivo, (m) => avisos.push(m));
    await corrompido.carregar();
    confere('arquivo ilegível: gravação suspensa', (corrompido.disjuntor?.motivo ?? '').includes('ilegível'), corrompido.disjuntor);
    const copia = await fs.readFile(`${arquivo}.ilegivel`, 'utf-8').catch(() => null);
    igual('cópia do arquivo ilegível guardada', copia, '{"processadas": [');
    igual('aviso no log', avisos.length, 1);
  }

  // -------------------------------------------------------------------------
  console.log('\n--- CRM fora do ar: a rodada falha e registra o erro ---');
  {
    const { crm } = montarCenario();
    crm.listarFunis = async () => {
      throw new Error('sem resposta do CRM');
    };
    const m = new Marcador(config({ MARCACAO_MODO: 'ativo' }), crm, await novoRegistro(), log, () => AGORA);
    let rejeitou = false;
    try {
      await m.rodada();
    } catch {
      rejeitou = true;
    }
    igual('rodada rejeita e guarda o erro', [rejeitou, m.ultimaRodada?.erro, Boolean(m.ultimaRodada?.fim)], [true, 'sem resposta do CRM', true]);
    igual('nada gravado', crm.puts.length, 0);
  }

  // -------------------------------------------------------------------------
  console.log('\n--- leitura do histórico: só lê, mesmo em modo ativo ---');
  {
    const { crm, ids } = montarCenario();
    const registro = await novoRegistro();
    const m = new Marcador(config({ MARCACAO_MODO: 'ativo' }), crm, registro, log, () => AGORA);
    const h = await m.lerHistorico(30);
    igual('nada gravado', [crm.puts.length, crm.tarefas.length], [0, 1]);
    igual('registro das rodadas intocado', [registro.jaProcessada(ids.N2), registro.ultimas(200).length], [false, 0]);
    const tipo = (nome: string) => h.negociacoes.find((n) => n.negociacao === ids[nome])?.tipo;
    igual('tipos no histórico', [tipo('N2'), tipo('N3'), tipo('N8'), tipo('P8'), tipo('P3'), tipo('N4')], ['Retorno', 'Possível duplicado', 'Novo', 'Possível duplicado', 'Novo', 'Novo']);
    confere('funil fora da marcação fica de fora', tipo('N5') === undefined);
    igual('estado final', [h.rodando, h.erro, h.erros, h.lidas === h.total], [false, null, 0, true]);
    confere('contagem por funil', (h.porFunil['Locação - Beta']?.['Retorno'] ?? 0) >= 4, h.porFunil);
    let segunda = '';
    m.historico = { ...h, rodando: true };
    try {
      await m.lerHistorico(30);
    } catch (e) {
      segunda = (e as Error).message;
    }
    igual('não roda duas leituras ao mesmo tempo', segunda, 'a leitura do histórico já está rodando');
  }

  // -------------------------------------------------------------------------
  console.log('\n--- cliente do CRM ---');
  {
    const TOKEN = 'tok-secreto-123';
    type Chamada = { url: string; init: { method: string; headers: Record<string, string>; body?: string } };
    const respostas: { status: number; corpo?: string; headers?: Record<string, string>; falhaDeRede?: boolean }[] = [];
    const chamadas: Chamada[] = [];
    const esperas: number[] = [];
    const buscador: Buscador = async (url, init) => {
      chamadas.push({ url, init });
      const r = respostas.shift() ?? { status: 200, corpo: '{}' };
      if (r.falhaDeRede) throw new TypeError('fetch failed');
      return {
        status: r.status,
        ok: r.status >= 200 && r.status < 300,
        headers: { get: (n: string) => r.headers?.[n.toLowerCase()] ?? null },
        text: async () => r.corpo ?? '',
      };
    };
    const cliente = () => new ClienteCrm(TOKEN, { base: 'https://crm.teste/api/v1', intervaloMs: 0, buscador, dormir: async (ms) => { esperas.push(ms); } });

    respostas.push({ status: 200, corpo: '{"contacts":[{"id":"c1"}]}' });
    const achados = await cliente().buscarContatosPorTelefone('19991110002');
    const u = new URL(chamadas[0].url);
    igual('busca por telefone', [u.pathname, u.searchParams.get('phone'), u.searchParams.get('limit'), u.searchParams.get('token'), achados.length], ['/api/v1/contacts', '19991110002', '200', TOKEN, 1]);

    {
      // Sem intervalo informado (como no serviço): até 40 chamadas por minuto
      const pausas: number[] = [];
      const padrao = new ClienteCrm(TOKEN, { base: 'https://crm.teste/api/v1', buscador, dormir: async (ms) => { pausas.push(ms); } });
      respostas.push({ status: 200, corpo: '{"tasks":[]}' }, { status: 200, corpo: '{"tasks":[]}' });
      await padrao.tarefasDaNegociacao('d1');
      await padrao.tarefasDaNegociacao('d1');
      confere('intervalo padrão de 1,5 s entre chamadas', pausas.length === 1 && pausas[0] > 1400 && pausas[0] <= 1500, pausas);
    }

    chamadas.length = 0;
    await cliente().atualizarCamposPersonalizados('d1', [{ custom_field_id: CAMPO, value: 'Retorno' }]);
    igual('PUT só com o campo',[chamadas[0].init.method, JSON.parse(chamadas[0].init.body as string)], ['PUT', { deal: { deal_custom_fields: [{ custom_field_id: CAMPO, value: 'Retorno' }] } }]);

    chamadas.length = 0;
    esperas.length = 0;
    respostas.push({ status: 429, headers: { 'retry-after': '2' } }, { status: 200, corpo: '{"tasks":[]}' });
    await cliente().tarefasDaNegociacao('d1');
    igual('429: espera o Retry-After e repete', [chamadas.length, esperas.includes(2000)], [2, true]);

    chamadas.length = 0;
    respostas.push({ status: 0, falhaDeRede: true });
    let erroPost = '';
    try {
      await cliente().criarTarefa({ deal_id: 'd1', user_ids: [U1], subject: 's', type: 'task', date: '2026-10-19', hour: '15:00', notes: 'n', done: false });
    } catch (e) {
      erroPost = (e as Error).message;
    }
    igual('POST não repete em falha de rede', chamadas.length, 1);
    confere('erro do POST sem token', erroPost !== '' && !erroPost.includes(TOKEN), erroPost);

    chamadas.length = 0;
    respostas.push({ status: 503 }, { status: 503 }, { status: 503 });
    let erroGet = '';
    try {
      await cliente().obterNegociacao('d1');
    } catch (e) {
      erroGet = (e as Error).message;
    }
    igual('GET repete até 3 vezes em erro 5xx', chamadas.length, 3);
    confere('erro do GET sem token', erroGet.includes('HTTP 503') && !erroGet.includes(TOKEN), erroGet);

    respostas.push({ status: 422, corpo: JSON.stringify({ errors: { token: TOKEN, campo: 'obrigatório' } }) });
    let erro422 = '';
    try {
      await cliente().atualizarCamposPersonalizados('d1', []);
    } catch (e) {
      erro422 = (e as Error).message;
    }
    confere('erro do CRM sem o corpo da resposta e sem token', erro422.includes('HTTP 422') && !erro422.includes('obrigatório') && !erro422.includes(TOKEN), erro422);

    chamadas.length = 0;
    esperas.length = 0;
    respostas.push({ status: 429, headers: { 'retry-after': '2' } });
    let erro429 = '';
    try {
      await cliente().atualizarCamposPersonalizados('d1', []);
    } catch (e) {
      erro429 = (e as Error).message;
    }
    igual('429 no PUT: não espera nem repete', [chamadas.length, esperas.length, erro429.includes('HTTP 429')], [1, 0, true]);

    esperas.length = 0;
    respostas.push({ status: 429, headers: { 'retry-after': '9999' } }, { status: 200, corpo: '{"tasks":[]}' });
    await cliente().tarefasDaNegociacao('d1');
    confere('Retry-After limitado a 2 minutos', esperas.includes(120000) && !esperas.includes(9999000), esperas);

    chamadas.length = 0;
    respostas.push({ status: 200, corpo: '' }, { status: 200, corpo: '' }, { status: 200, corpo: '' });
    let erroVazio = '';
    try {
      await cliente().buscarContatosPorEmail('a@b.com');
    } catch (e) {
      erroVazio = (e as Error).message;
    }
    igual('resposta vazia: repete e falha', [chamadas.length, erroVazio.includes('resposta vazia')], [3, true]);

    respostas.push({ status: 200, corpo: '{"total":0}' });
    let erroSemLista = '';
    try {
      await cliente().buscarContatosPorTelefone('19991110002');
    } catch (e) {
      erroSemLista = (e as Error).message;
    }
    confere('resposta sem a lista é erro, não lista vazia', erroSemLista.includes('sem "contacts"'), erroSemLista);

    respostas.push({ status: 200, corpo: '{"id":"outra"}' });
    let erroOutra = '';
    try {
      await cliente().obterNegociacao('d1');
    } catch (e) {
      erroOutra = (e as Error).message;
    }
    confere('negociação diferente da pedida é erro', erroOutra.includes('não é esta negociação'), erroOutra);
  }

  console.log(`\n${falhas === 0 ? 'ALL PASS' : falhas + ' FAILED'}`);
  process.exit(falhas === 0 ? 0 : 1);
}

testes().catch((e) => {
  console.error('FAIL erro inesperado nos testes:', e);
  process.exit(1);
});
