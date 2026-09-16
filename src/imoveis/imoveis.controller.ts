import {
  Controller,
  Get,
  Query,
  Headers,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ImoveisService } from './imoveis.service';

@Controller('imoveis-disponiveis')
export class ImoveisController {
  private readonly logger = new Logger(ImoveisController.name);

  /** protocolo -> { criterios, enviados, quando } */
  private paginacao = new Map<
    string,
    { criterios: string; enviados: Set<string>; quando: number }
  >();
  private readonly VALIDADE_PAGINACAO_MS = 24 * 60 * 60 * 1000;

  constructor(private readonly imoveisService: ImoveisService) {}

  @Get()
  async buscar(
    @Headers('authorization') authHeader: string,
    @Headers('x-api-token') xApiToken: string | undefined,
    @Headers('x-bairro') xBairro: string | undefined,
    @Headers('x-tipo') xTipo: string | undefined,
    @Headers('x-dormitorios') xDormitorios: string | undefined,
    @Headers('x-dormitorios-exato') xDormitoriosExato: string | undefined,
    @Headers('x-valor-max') xValorMax: string | undefined,
    @Headers('x-vagas-min') xVagasMin: string | undefined,
    @Headers('x-offset') xOffset: string | undefined,
    @Headers('x-limit') xLimit: string | undefined,
    @Headers('x-protocolo') xProtocolo: string | undefined,
    @Query('bairro') qBairro?: string,
    @Query('tipo') qTipo?: string,
    @Query('dormitorios') qDormitorios?: string,
    @Query('dormitorios_exato') qDormitoriosExato?: string,
    @Query('valor_max') qValorMax?: string,
    @Query('vagas_min') qVagasMin?: string,
    @Query('token') qToken?: string,
    @Query('offset') qOffset?: string,
    @Query('limit') qLimit?: string,
    @Query('protocolo') qProtocolo?: string,
  ) {
    const bairro = xBairro || qBairro;
    const tipo = xTipo || qTipo;
    const dormitorios = xDormitorios || qDormitorios;
    // aceita "true", "1", "sim", "exato" (qualquer caixa) como modo exato
    const dormitoriosExatoRaw = xDormitoriosExato || qDormitoriosExato;
    const dormitoriosExato = /^(true|1|sim|exato)$/i.test(
      (dormitoriosExatoRaw || '').trim(),
    );
    const valorMax = xValorMax || qValorMax;
    const vagasMin = xVagasMin || qVagasMin;
    const offset = xOffset || qOffset;
    const limit = xLimit || qLimit;

    this.logger.log(
      `Requisição recebida — bairro=${bairro} tipo=${tipo} dormitorios=${dormitorios} exato=${dormitoriosExato} valor_max=${valorMax} vagas_min=${vagasMin} offset=${offset} temToken=${!!authHeader} origem=${xBairro || xTipo ? 'headers' : 'query'}`,
    );

    this.validarToken(authHeader, xApiToken, qToken);

    const NUMERO_EXTENSO: Record<string, number> = {
      zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4,
      cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
    };

    const extrairNumero = (texto: string | undefined): number | undefined => {
      if (!texto) return undefined;

      const limpo = texto
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase();

      // "3 mil", "2,5 mil" -> multiplica por 1000
      const mil = limpo.replace(/\./g, '').match(/(\d+(?:,\d+)?)\s*mil\b/);
      if (mil) return Math.round(Number(mil[1].replace(',', '.')) * 1000);

      const match = limpo.replace(/\./g, '').match(/\d+/);
      if (match) return Number(match[0]);

      // "dois", "tres quartos" -> numero por extenso
      for (const [palavra, valor] of Object.entries(NUMERO_EXTENSO)) {
        if (new RegExp('\\b' + palavra + '\\b').test(limpo)) return valor;
      }

      return undefined;
    };

    const dormitoriosNum = extrairNumero(dormitorios);
    const valorMaxNum = extrairNumero(valorMax);
    const vagasMinNum = extrairNumero(vagasMin);
    const offsetNum = extrairNumero(offset) ?? 0;
    const limitNum = extrairNumero(limit) ?? 3;

    const todos = await this.imoveisService.buscar({
      bairro,
      tipo,
      dormitorios: dormitoriosNum,
      dormitoriosExato,
      valorMax: valorMaxNum,
      vagasMin: vagasMinNum,
    });

    const protocolo = (xProtocolo || qProtocolo || '').trim();
    let resultados: any[];
    let temMais: boolean;

    if (protocolo) {
      const criterios = JSON.stringify({
        bairro: bairro ?? null,
        tipo: tipo ?? null,
        dormitorios: dormitoriosNum ?? null,
        dormitoriosExato,
        valorMax: valorMaxNum ?? null,
        vagasMin: vagasMinNum ?? null,
      });

      this.limparPaginacaoExpirada();

      let estado = this.paginacao.get(protocolo);
      if (!estado || estado.criterios !== criterios) {
        estado = { criterios, enviados: new Set<string>(), quando: Date.now() };
        this.paginacao.set(protocolo, estado);
      }

      const naoEnviados = todos.filter(
        (im) => !estado!.enviados.has(String(im.codigo)),
      );
      resultados = naoEnviados.slice(0, limitNum);
      resultados.forEach((im) => estado!.enviados.add(String(im.codigo)));
      estado.quando = Date.now();
      temMais = naoEnviados.length > limitNum;
    } else {
      resultados = todos.slice(offsetNum, offsetNum + limitNum);
      temMais = todos.length > offsetNum + limitNum;
    }

    const incluirFechamento = !limit;
    const buscaIndividual = limitNum === 1;
    const mensagem = buscaIndividual && resultados.length === 0
      ? ''
      : this.formatarMensagem(resultados, temMais, incluirFechamento);
    const mensagens = this.formatarMensagens(resultados, temMais, incluirFechamento);

    return { mensagem, mensagens, resultados, temMais };
  }

  private formatarMensagem(resultados: any[], temMais: boolean, incluirFechamento = true): string {
    if (!resultados || resultados.length === 0) {
      return 'No momento não encontrei nenhum imóvel disponível com esse perfil. Posso registrar seus critérios de busca para que nossa equipe entre em contato assim que surgirem opções?';
    }

    const formatarValor = (valor: number | undefined) =>
      valor !== undefined && valor !== null
        ? valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : undefined;

    const itens = resultados.map((im) => {
      const linhas: string[] = [];
      linhas.push(`🏡 *Chave*: ${im.codigo}`);
      linhas.push(`*${im.tipo}* em ${im.bairro}`);
      linhas.push('');
      if (im.valor_locacao !== undefined && im.valor_locacao !== null) {
        linhas.push(`*Aluguel*: R$ ${formatarValor(im.valor_locacao)}`);
      }
      if (im.valor_condominio != null && im.valor_condominio > 0) {
        linhas.push(`*Condomínio*: R$ ${formatarValor(im.valor_condominio)}`);
      }
      linhas.push(
        im.dormitorios != null
          ? `*Quartos*: ${im.dormitorios}`
          : '*Quartos*: não informado',
      );
      if (im.vagas_garagem) linhas.push(`*Vagas*: ${im.vagas_garagem}`);
      if (im.metragem) linhas.push(`*Metragem*: ${im.metragem}m²`);
      linhas.push('');
      linhas.push('_Os valores estão sujeitos a alterações._');
      if (im.link) {
        linhas.push('');
        linhas.push(im.link);
      }
      return linhas.join('\n');
    });

    const corpo = itens.join('\n\n---\n\n');
    if (!incluirFechamento) return corpo;
    const fechamento = temMais
      ? `\n\n*Gostou de alguma dessas opções, ou quer que eu envie mais 3?*`
      : `\n\n*Gostou de alguma dessas opções?*`;

    return corpo + fechamento;
  }

  private formatarMensagens(resultados: any[], temMais: boolean, incluirFechamento = true): string[] {
    if (!resultados || resultados.length === 0) {
      return ['No momento não encontrei nenhum imóvel disponível com esse perfil. Posso registrar seus critérios de busca para que nossa equipe entre em contato assim que surgirem opções?'];
    }

    const formatarValor = (valor: number | undefined) =>
      valor !== undefined && valor !== null
        ? valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : undefined;

    const mensagens: string[] = resultados.map((im) => {
      const linhas: string[] = [];
      linhas.push(`🏡 *Chave*: ${im.codigo}`);
      linhas.push(`*${im.tipo}* em ${im.bairro}`);
      linhas.push('');
      if (im.valor_locacao !== undefined && im.valor_locacao !== null) {
        linhas.push(`*Aluguel*: R$ ${formatarValor(im.valor_locacao)}`);
      }
      if (im.valor_condominio != null && im.valor_condominio > 0) {
        linhas.push(`*Condomínio*: R$ ${formatarValor(im.valor_condominio)}`);
      }
      linhas.push(
        im.dormitorios != null
          ? `*Quartos*: ${im.dormitorios}`
          : '*Quartos*: não informado',
      );
      if (im.vagas_garagem) linhas.push(`*Vagas*: ${im.vagas_garagem}`);
      if (im.metragem) linhas.push(`*Metragem*: ${im.metragem}m²`);
      linhas.push('');
      linhas.push('_Os valores estão sujeitos a alterações._');
      if (im.link) {
        linhas.push('');
        linhas.push(im.link);
      }
      return linhas.join('\n');
    });

    if (incluirFechamento) {
      mensagens.push(temMais
        ? '*Gostou de alguma dessas opções, ou quer que eu envie mais 3?*'
        : '*Gostou de alguma dessas opções?*');
    }

    return mensagens;
  }

  /** Remove protocolos sem uso há mais de 24h. */
  private limparPaginacaoExpirada(): void {
    const agora = Date.now();
    for (const [chave, estado] of this.paginacao) {
      if (agora - estado.quando > this.VALIDADE_PAGINACAO_MS) {
        this.paginacao.delete(chave);
      }
    }
  }

  private validarToken(authHeader: string | undefined, xApiToken: string | undefined, qToken: string | undefined) {
    const tokenEsperado = process.env.API_TOKEN;
    if (!tokenEsperado) {
      this.logger.warn('API_TOKEN não configurado no servidor');
      throw new UnauthorizedException('API_TOKEN não configurado no servidor');
    }
    const tokenViaAuth = authHeader?.replace('Bearer ', '');
    const tokenRecebido = qToken || xApiToken || tokenViaAuth;
    if (tokenRecebido !== tokenEsperado) {
      this.logger.warn(`Token inválido recebido: authorization="${authHeader}" x-api-token="${xApiToken}" query-token="${qToken}"`);
      throw new UnauthorizedException('Token inválido');
    }
  }
}
