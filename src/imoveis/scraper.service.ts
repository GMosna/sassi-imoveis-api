import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as cheerio from 'cheerio';
import { promises as fs } from 'fs';
import * as path from 'path';

export interface Imovel {
  codigo: number;
  tipo: string;
  bairro: string;
  valor_locacao: number;
  valor_condominio: number | null;
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
  private readonly cacheFile = path.join(
    process.env.CACHE_DIR || '/tmp',
    'imoveis-cache.json',
  );

  /** codigo do imovel -> { valor, quando } */
  private condominioConhecido = new Map<
    string,
    { valor: number | null; quando: number }
  >();
  private readonly VALIDADE_CONDOMINIO_MS = 24 * 60 * 60 * 1000;

  constructor() {
    this.useMock = process.env.USE_MOCK_DATA === 'true';
  }

  onModuleInit() {
    if (this.useMock) return;
    // Não await: a API precisa responder imediatamente. O scrape popula o
    // cache em segundo plano; até lá, o cache carregado do disco atende.
    void this.carregarCacheDoDisco().then(() => this.scrape());
  }

  /** Carrega o cache do disco para atender já nos primeiros segundos. */
  private async carregarCacheDoDisco(): Promise<void> {
    try {
      const conteudo = await fs.readFile(this.cacheFile, 'utf-8');
      const dados = JSON.parse(conteudo);

      if (Array.isArray(dados)) {
        // Formato antigo: array puro de imóveis
        if (dados.length) {
          this.cache = dados;
          this.logger.log(`Cache carregado do disco: ${dados.length} imóveis`);
        }
      } else if (dados && typeof dados === 'object') {
        // Formato novo: { imoveis, condominios }
        if (Array.isArray(dados.imoveis) && dados.imoveis.length) {
          this.cache = dados.imoveis;
          this.logger.log(
            `Cache carregado do disco: ${dados.imoveis.length} imóveis`,
          );
        }
        if (Array.isArray(dados.condominios)) {
          this.condominioConhecido = new Map(dados.condominios);
        }
      }
    } catch {
      this.logger.log('Sem cache em disco — aguardando primeiro scrape');
    }
  }

  /** Salva o cache. Falha aqui nunca pode derrubar o scrape. */
  private async salvarCacheEmDisco(): Promise<void> {
    try {
      const payload = {
        imoveis: this.cache,
        condominios: Array.from(this.condominioConhecido.entries()),
      };
      await fs.writeFile(this.cacheFile, JSON.stringify(payload), 'utf-8');
    } catch (err) {
      this.logger.warn(`Não consegui salvar o cache em disco: ${err}`);
    }
  }

  @Cron('0 */20 * * * *')
  async scrape() {
    if (this.useMock) return;
    this.logger.log('Iniciando scrape do site Sassi Imóveis...');
    try {
      const resultado = await this.buscarTodosImoveis();
      this.cache = resultado;
      await this.salvarCacheEmDisco();
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

    await this.enriquecerComCondominio(todos);
    return todos;
  }

  /** Busca o valor do condomínio na página interna do imóvel. Nunca lança. */
  private async buscarCondominio(link: string): Promise<number | null> {
    try {
      const res = await fetch(link, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SassiImoveisBot/1.0)' },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return null;

      const $ = cheerio.load(await res.text());
      const texto = $('div#imovelExtra').text().replace(/\s+/g, ' ');
      const m = texto.match(/Condom[ií]nio:?\s*(R\$\s*[\d.,]+)/i);
      return m ? parseBRNumber(m[1]) || null : null;
    } catch (err) {
      this.logger.debug(`Condomínio não obtido em ${link}: ${err}`);
      return null;
    }
  }

  /** Preenche valor_condominio dos apartamentos, em lotes, sem derrubar o scrape. */
  private async enriquecerComCondominio(imoveis: Imovel[]): Promise<void> {
    const semAcento = (s: string) =>
      (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

    const alvos = imoveis.filter((im) => {
      const t = semAcento(im.tipo);
      return t.includes('apartamento') || t.includes('condominio');
    });

    if (alvos.length === 0) return;

    const agora = Date.now();
    const pendentes: Imovel[] = [];

    for (const im of alvos) {
      const conhecido = this.condominioConhecido.get(String(im.codigo));
      if (conhecido && agora - conhecido.quando < this.VALIDADE_CONDOMINIO_MS) {
        im.valor_condominio = conhecido.valor;
      } else {
        pendentes.push(im);
      }
    }

    if (pendentes.length === 0) {
      this.logger.log(
        `Condomínio: ${alvos.length} apartamentos, todos reaproveitados do cache`,
      );
      return;
    }

    const TAMANHO_LOTE = 5;
    let encontrados = 0;

    for (let i = 0; i < pendentes.length; i += TAMANHO_LOTE) {
      const lote = pendentes.slice(i, i + TAMANHO_LOTE);
      await Promise.all(
        lote.map(async (im) => {
          im.valor_condominio = await this.buscarCondominio(im.link);
          this.condominioConhecido.set(String(im.codigo), {
            valor: im.valor_condominio,
            quando: Date.now(),
          });
          if (im.valor_condominio != null) encontrados++;
        }),
      );
      await delay(400);
    }

    this.logger.log(
      `Condomínio: ${encontrados}/${pendentes.length} buscados, ` +
        `${alvos.length - pendentes.length} reaproveitados`,
    );
  }

  private extrairCard($: cheerio.CheerioAPI, card: any): Imovel | null {
    try {
      const selo = $(card).find('div.selo').text().trim().toLowerCase();
      if (selo.includes('reservado')) return null;

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

      // valor_condominio nao aparece no card da listagem (so na pagina interna
      // do imovel). Buscar cada pagina custaria N+1 requests por scrape; deixado
      // como null ate decisao explicita sobre esse trade-off.
      const valor_condominio: number | null = null;

      return { codigo, tipo, bairro, valor_locacao, valor_condominio, dormitorios, vagas_garagem, metragem, link, foto };
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
