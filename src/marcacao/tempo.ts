/**
 * Datas no fuso de São Paulo, prazo em horas úteis e data de criação pelo ID.
 *
 * As funções trabalham com o "horário de parede" de São Paulo guardado num
 * Date em UTC (getUTCHours = hora local). Assim a conta de horário comercial
 * não depende do fuso da máquina onde a API roda.
 */

export const FUSO = 'America/Sao_Paulo';

export interface Expediente {
  inicioHora: number;
  fimHora: number;
}

/** Segunda a sexta, das 8h às 18h (decisão 9, de 16/10/2026). */
export const EXPEDIENTE_PADRAO: Expediente = { inicioHora: 8, fimHora: 18 };

const formatador = new Intl.DateTimeFormat('en-US', {
  timeZone: FUSO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** Devolve o horário de parede de São Paulo num Date em UTC. */
export function horaLocal(instante: Date): Date {
  const partes = formatador.formatToParts(instante);
  const valor = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value ?? '0');
  return new Date(
    Date.UTC(valor('year'), valor('month') - 1, valor('day'), valor('hour'), valor('minute'), valor('second')),
  );
}

const dois = (n: number) => String(n).padStart(2, '0');

/** "AAAA-MM-DDTHH:MM:SS" no horário de São Paulo, formato dos filtros da API do CRM. */
export function paraFiltroCrm(instante: Date): string {
  const l = horaLocal(instante);
  return (
    `${l.getUTCFullYear()}-${dois(l.getUTCMonth() + 1)}-${dois(l.getUTCDate())}` +
    `T${dois(l.getUTCHours())}:${dois(l.getUTCMinutes())}:${dois(l.getUTCSeconds())}`
  );
}

/** "DD/MM/AAAA" no horário de São Paulo; "?" se a data não existir. */
export function dataBR(iso: string | null | undefined): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return '?';
  const l = horaLocal(new Date(t));
  return `${dois(l.getUTCDate())}/${dois(l.getUTCMonth() + 1)}/${l.getUTCFullYear()}`;
}

/** "DD/MM/AAAA às HH:MM" no horário de São Paulo. */
export function dataHoraBR(iso: string | null | undefined): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return '?';
  const l = horaLocal(new Date(t));
  return `${dataBR(iso)} às ${dois(l.getUTCHours())}:${dois(l.getUTCMinutes())}`;
}

function inicioDoProximoDia(l: Date, hora: number): Date {
  return new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate() + 1, hora, 0, 0));
}

/**
 * Prazo somando minutos úteis a partir de agora: só conta segunda a sexta,
 * dentro do expediente. Ex.: 17h30 de sexta + 60 min = 8h30 de segunda.
 * Devolve data e hora no formato da tarefa do CRM.
 */
export function prazoUtil(
  agora: Date,
  minutos = 60,
  expediente: Expediente = EXPEDIENTE_PADRAO,
): { data: string; hora: string } {
  let l = horaLocal(agora);
  l = new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate(), l.getUTCHours(), l.getUTCMinutes(), 0));
  let restante = Math.max(0, minutos);

  for (let volta = 0; volta < 60; volta++) {
    const diaSemana = l.getUTCDay();
    const inicio = Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate(), expediente.inicioHora, 0, 0);
    const fim = Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate(), expediente.fimHora, 0, 0);

    if (diaSemana === 0 || diaSemana === 6 || l.getTime() >= fim) {
      l = inicioDoProximoDia(l, expediente.inicioHora);
      continue;
    }
    if (l.getTime() < inicio) l = new Date(inicio);

    const disponivel = (fim - l.getTime()) / 60000;
    if (restante <= disponivel) {
      l = new Date(l.getTime() + restante * 60000);
      break;
    }
    restante -= disponivel;
    l = inicioDoProximoDia(l, expediente.inicioHora);
  }

  return {
    data: `${l.getUTCFullYear()}-${dois(l.getUTCMonth() + 1)}-${dois(l.getUTCDate())}`,
    hora: `${dois(l.getUTCHours())}:${dois(l.getUTCMinutes())}`,
  };
}

/**
 * Os IDs do RD CRM são ObjectIds: os 8 primeiros caracteres são o segundo da
 * criação. Confere com as datas do CRM (ex.: o campo "Tipo de entrada" foi
 * criado em 16/10/2026 e seu ID começa com 6ad21923). Devolve null se o ID
 * não tiver esse formato.
 */
export function criadaEmPeloId(id: string): Date | null {
  if (!/^[0-9a-f]{24}$/i.test(id)) return null;
  return new Date(parseInt(id.slice(0, 8), 16) * 1000);
}
