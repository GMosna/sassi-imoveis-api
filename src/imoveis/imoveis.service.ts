import { Injectable } from '@nestjs/common';
import { ScraperService } from './scraper.service';

export interface FiltroImoveis {
  bairro?: string;
  tipo?: string;
  dormitorios?: number;
  valorMax?: number;
  vagasMin?: number;
}

function norm(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

const TIPO_SINONIMOS: Record<string, string> = {
  'apto': 'apartamento',
  'ap': 'apartamento',
  'kitnet': 'kitinet',
  'casa cond': 'casa em condominio',
  'cond': 'casa em condominio',
};

function normTipo(s: string): string {
  const n = norm(s).trim();
  return TIPO_SINONIMOS[n] ?? n;
}

const BAIRRO_ABREV: [RegExp, string][] = [
  [/\bjardim\b/g, 'jd.'],
  [/\bjd(?!\.)\b/g, 'jd.'],
  [/\bparque\b/g, 'pq.'],
  [/\bpq(?!\.)\b/g, 'pq.'],
  [/\bcondominio\b/g, 'cond.'],
  [/\bcond(?!\.)\b/g, 'cond.'],
  [/\bresidencial\b/g, 'resid.'],
  [/\bresid(?!\.)\b/g, 'resid.'],
];

function normBairro(s: string): string {
  let n = norm(s);
  for (const [pattern, replacement] of BAIRRO_ABREV) {
    n = n.replace(pattern, replacement);
  }
  return n;
}

const BAIRRO_EXPAND: [RegExp, string][] = [
  [/\bjd\.?\b/g, 'jardim'],
  [/\bpq\.?\b/g, 'parque'],
  [/\bcond\.?\b/g, 'condominio'],
  [/\bresid\.?\b/g, 'residencial'],
];

function normBairroExpanded(s: string): string {
  let n = norm(s);
  for (const [pattern, replacement] of BAIRRO_EXPAND) {
    n = n.replace(pattern, replacement);
  }
  return n;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

export function fuzzyContains(haystack: string, needle: string, threshold: number): boolean {
  if (haystack.includes(needle)) return true;
  const n = needle.length;
  if (n < 4) return false;
  const minLen = Math.max(1, n - threshold);
  const maxLen = n + threshold;
  for (let len = minLen; len <= maxLen; len++) {
    if (len > haystack.length) break;
    for (let i = 0; i + len <= haystack.length; i++) {
      const window = haystack.substring(i, i + len);
      if (levenshtein(window, needle) <= threshold) return true;
    }
  }
  return false;
}

export function bairroThreshold(qLen: number): number {
  if (qLen < 5) return 0;
  return qLen >= 10 ? 2 : 1;
}

export function filtrarPorBairro<T extends { bairro: string }>(imoveis: T[], bairro: string): T[] {
  const q = normBairro(bairro);
  const exatos = imoveis.filter((im) => norm(im.bairro).includes(q));
  if (exatos.length > 0) return exatos;
  const qExp = normBairroExpanded(bairro);
  const threshold = bairroThreshold(qExp.length);
  if (threshold === 0) return exatos;
  return imoveis.filter((im) => fuzzyContains(normBairroExpanded(im.bairro), qExp, threshold));
}

const IMOVEIS_MOCK = [
  {
    codigo: 1001,
    tipo: 'Apartamento',
    bairro: 'Cambuí',
    valor_locacao: 1650,
    dormitorios: 2,
    vagas_garagem: 1,
    metragem: null,
    link: 'https://sassiimoveis.com.br/imovel-aluguel/1001/apartamento-cambui',
  },
  {
    codigo: 2002,
    tipo: 'Casa em Condomínio',
    bairro: 'Jardim Nova Europa',
    valor_locacao: 2400,
    dormitorios: 3,
    vagas_garagem: 2,
    metragem: null,
    link: 'https://sassiimoveis.com.br/imovel-aluguel/2002/casa-jardim-nova-europa',
  },
  {
    codigo: 1003,
    tipo: 'Apartamento',
    bairro: 'Cambuí',
    valor_locacao: 1200,
    dormitorios: 1,
    vagas_garagem: 1,
    metragem: null,
    link: 'https://sassiimoveis.com.br/imovel-aluguel/1003/apartamento-cambui',
  },
];

@Injectable()
export class ImoveisService {
  private readonly useMock: boolean;

  constructor(private readonly scraperService: ScraperService) {
    this.useMock = process.env.USE_MOCK_DATA === 'true';
    if (this.useMock) {
      console.log('[ImoveisService] USE_MOCK_DATA=true -- respondendo com dados fictícios, sem scraping.');
    }
  }

  async buscar(filtro: FiltroImoveis): Promise<any[]> {
    if (this.useMock) {
      return this.buscarMock(filtro);
    }
    return this.buscarNoCache(filtro);
  }

  private buscarMock(filtro: FiltroImoveis) {
    let imoveis = IMOVEIS_MOCK as any[];
    if (filtro.bairro) {
      imoveis = filtrarPorBairro(imoveis, filtro.bairro);
    }
    return imoveis.filter((im) => {
      if (filtro.tipo && !norm(im.tipo).includes(normTipo(filtro.tipo))) return false;
      if (filtro.dormitorios !== undefined && (im.dormitorios === null || im.dormitorios < filtro.dormitorios)) return false;
      if (filtro.valorMax !== undefined && im.valor_locacao > filtro.valorMax) return false;
      if (filtro.vagasMin !== undefined && (im.vagas_garagem === null || im.vagas_garagem < filtro.vagasMin)) return false;
      return true;
    });
  }

  private buscarNoCache(filtro: FiltroImoveis) {
    let imoveis = this.scraperService.getCache();

    if (filtro.bairro) {
      imoveis = filtrarPorBairro(imoveis, filtro.bairro);
    }
    if (filtro.tipo) {
      imoveis = imoveis.filter((im) => norm(im.tipo).includes(normTipo(filtro.tipo!)));
    }
    if (filtro.dormitorios !== undefined) {
      imoveis = imoveis.filter((im) => im.dormitorios !== null && im.dormitorios >= filtro.dormitorios!);
    }
    if (filtro.valorMax !== undefined) {
      imoveis = imoveis.filter((im) => im.valor_locacao <= filtro.valorMax!);
    }
    if (filtro.vagasMin !== undefined) {
      imoveis = imoveis.filter(
        (im) => im.vagas_garagem !== null && im.vagas_garagem >= filtro.vagasMin!,
      );
    }

    return imoveis;
  }
}