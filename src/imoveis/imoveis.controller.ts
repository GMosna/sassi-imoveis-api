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

  constructor(private readonly imoveisService: ImoveisService) {}

  @Get()
  async buscar(
    @Headers('authorization') authHeader: string,
    @Headers('x-api-token') xApiToken: string | undefined,
    @Headers('x-bairro') xBairro: string | undefined,
    @Headers('x-tipo') xTipo: string | undefined,
    @Headers('x-dormitorios') xDormitorios: string | undefined,
    @Headers('x-valor-max') xValorMax: string | undefined,
    @Headers('x-vagas-min') xVagasMin: string | undefined,
    @Headers('x-offset') xOffset: string | undefined,
    @Headers('x-limit') xLimit: string | undefined,
    @Query('bairro') qBairro?: string,
    @Query('tipo') qTipo?: string,
    @Query('dormitorios') qDormitorios?: string,
    @Query('valor_max') qValorMax?: string,
    @Query('vagas_min') qVagasMin?: string,
    @Query('token') qToken?: string,
    @Query('offset') qOffset?: string,
    @Query('limit') qLimit?: string,
  ) {
    const bairro = xBairro || qBairro;
    const tipo = xTipo || qTipo;
    const dormitorios = xDormitorios || qDormitorios;
    const valorMax = xValorMax || qValorMax;
    const vagasMin = xVagasMin || qVagasMin;
    const offset = xOffset || qOffset;
    const limit = xLimit || qLimit;

    this.logger.log(
      `Requisição recebida — bairro=${bairro} tipo=${tipo} dormitorios=${dormitorios} valor_max=${valorMax} vagas_min=${vagasMin} offset=${offset} temToken=${!!authHeader} origem=${xBairro || xTipo ? 'headers' : 'query'}`,
    );

    this.validarToken(authHeader, xApiToken, qToken);

    const extrairNumero = (texto: string | undefined): number | undefined => {
      if (!texto) return undefined;
      const match = texto.replace(/\./g, '').match(/\d+/);
      return match ? Number(match[0]) : undefined;
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
      valorMax: valorMaxNum,
      vagasMin: vagasMinNum,
    });

    const resultados = todos.slice(offsetNum, offsetNum + limitNum);
    const temMais = todos.length > offsetNum + limitNum;

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
      linhas.push(`🏡 *Código*: ${im.codigo}`);
      linhas.push(`*${im.tipo}* em ${im.bairro}`);
      linhas.push('');
      if (im.valor_locacao !== undefined) {
        linhas.push(`*Aluguel*: R$ ${formatarValor(im.valor_locacao)}`);
      }
      const detalhes: string[] = [];
      if (im.dormitorios != null) detalhes.push(`*Quartos*: ${im.dormitorios}`);
      else detalhes.push(`*Quartos*: não informado`);
      if (im.vagas_garagem) detalhes.push(`*Vagas*: ${im.vagas_garagem}`);
      if (im.metragem) detalhes.push(`${im.metragem}m²`);
      if (detalhes.length) linhas.push(detalhes.join(' · '));
      linhas.push('');
      linhas.push('_Os valores estão sujeitos a alterações._');
      if (im.foto) {
        linhas.push('');
        linhas.push(`📷 ${im.foto}`);
      }
      if (im.link) {
        linhas.push('');
        linhas.push(`🔗 ${im.link}`);
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
      linhas.push(`🏡 *Código*: ${im.codigo}`);
      linhas.push(`*${im.tipo}* em ${im.bairro}`);
      linhas.push('');
      if (im.valor_locacao !== undefined) {
        linhas.push(`*Aluguel*: R$ ${formatarValor(im.valor_locacao)}`);
      }
      const detalhes: string[] = [];
      if (im.dormitorios != null) detalhes.push(`*Quartos*: ${im.dormitorios}`);
      else detalhes.push(`*Quartos*: não informado`);
      if (im.vagas_garagem) detalhes.push(`*Vagas*: ${im.vagas_garagem}`);
      if (im.metragem) detalhes.push(`${im.metragem}m²`);
      if (detalhes.length) linhas.push(detalhes.join(' · '));
      linhas.push('');
      linhas.push('_Os valores estão sujeitos a alterações._');
      if (im.foto) {
        linhas.push('');
        linhas.push(`📷 ${im.foto}`);
      }
      if (im.link) {
        linhas.push('');
        linhas.push(`🔗 ${im.link}`);
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
