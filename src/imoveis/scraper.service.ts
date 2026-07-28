import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as cheerio from 'cheerio';

export interface Imovel {
  codigo: number;
  tipo: string;
  bairro: string;
  valor_locacao: number;
  dormitorios: number | null;
  vagas_garagem: number | null;
  metragem: number | null;
  link: string;
  foto?: string;
}

@Injectable()
export class ScraperService implements OnModuleInit {
  private readonly logger = new Logger(ScraperService.name);
  private cache: Imovel[] = [];
  private readonly useMock: boolean;

  constructor() {
    this.useMock = process.env.USE_MOCK_DATA === 'true';
  }

  async onModuleInit() {
    if (!this.useMock) {
      await this.scrape();
    }
  }

  @Cron('0 */20 * * * *')
  async scrape() {
    if (this.useMock) return;
    this.logger.log('Iniciando scrape do site Sassi Imóveis...');
    try {
      const resultado = await this.buscarTodosImoveis();
      this.cache = resultado;
      this.logger.log(`Scrape concluído: ${resultado.length} imóveis encontrados`);
    } catch (err) {
      this.logger.error(
        `Scrape falhou — mantendo cache anterior (${this.cache.length} imóveis). Erro: ${err}`,
      );
    }
  }

  getCache(): Imovel[] {
    return this.cache;
  }

  private async buscarTodosImoveis(): Promise<Imovel[]> {
    const todos: Imovel[] = [];
    let page = 1;

    while (true) {
      const url = `https://sassiimoveis.com.br/alugar?page=${page}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SassiImoveisBot/1.0)' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ao buscar ${url}`);

      const html = await res.text();
      const $ = cheerio.load(html);
      const cards = $('div.imovel');

      if (cards.length === 0) break;

      cards.each((_, card) => {
        const imovel = this.extrairCard($, card);
        if (imovel) todos.push(imovel);
      });

      this.logger.debug(`Página ${page}: ${cards.length} cards extraídos`);
      page++;
      await delay(400);
    }

    return todos;
  }

  private extrairCard($: cheerio.CheerioAPI, card: any): Imovel | null {
    try {
      const selo = $(card).find('div.selo').text().trim().toLowerCase();
      if (selo.includes('reservado') || selo.includes('em breve')) return null;

      const h2Text = $(card).find('a[href^="/imovel-aluguel"] h2').first().text().trim();
      const partes = h2Text.split('|').map((s) => s.trim());
      const tipo = partes[0] ?? '';
      const bairro = partes[1] ?? '';

      const href = $(card).find('a[href^="/imovel-aluguel"]').first().attr('href') ?? '';
      const link = `https://sassiimoveis.com.br${href}`;

      const chaveText = $(card).find('div.imovelChave').text().replace(/\s+/g, ' ').trim();
      const chaveMatch = chaveText.match(/Chave:\s*(\d+)/);
      const aluguelMatch = chaveText.match(/Aluguel:\s*(R\$[\d.,]+)/);

      const codigo = chaveMatch ? parseInt(chaveMatch[1], 10) : 0;
      const valor_locacao = aluguelMatch ? parseBRNumber(aluguelMatch[1]) : 0;

      let dormitorios: number | null = null;
      let vagas_garagem: number | null = null;
      let metragem: number | null = null;

      $(card)
        .find('div.imovelIcones div')
        .each((_, iconDiv) => {
          const alt = $(iconDiv).find('img').attr('alt');
          const val = $(iconDiv).text().trim();
          if (alt === 'Quartos') dormitorios = parseIntOrNull(val);
          if (alt === 'Garagem') vagas_garagem = parseIntOrNull(val);
          if (alt === 'Metragem') metragem = parseBRNumber(val) || null;
        });

      const fotoStyle = $(card).find('div.imovelFoto').first().attr('style') ?? '';
      const fotoMatch = fotoStyle.match(/url\(([^)]+)\)/);
      const fotoPath = fotoMatch ? fotoMatch[1] : null;
      const foto = fotoPath
        ? (fotoPath.startsWith('http') ? fotoPath : `https://sassiimoveis.com.br${fotoPath}`)
        : undefined;

      return { codigo, tipo, bairro, valor_locacao, dormitorios, vagas_garagem, metragem, link, foto };
    } catch (err) {
      this.logger.warn(`Erro ao extrair card: ${err}`);
      return null;
    }
  }
}

function parseBRNumber(s: string): number {
  return Number(
    s.replace('R$', '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.'),
  );
}

function parseIntOrNull(s: string): number | null {
  const n = parseInt(s, 10);
  return isNaN(n) ? null : n;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
