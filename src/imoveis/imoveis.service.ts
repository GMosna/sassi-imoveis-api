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
  'casa cond': 'casa em condominio',
  'cond': 'casa em condominio',
};

function normTipo(s: string): string {
  const n = norm(s).trim();
  return TIPO_SINONIMOS[n] ?? n;
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
    return IMOVEIS_MOCK.filter((im) => {
      if (filtro.bairro && !norm(im.bairro).includes(norm(filtro.bairro))) return false;
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
      imoveis = imoveis.filter((im) => norm(im.bairro).includes(norm(filtro.bairro!)));
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