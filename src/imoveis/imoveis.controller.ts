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
    @Query('bairro') qBairro?: string,
    @Query('tipo') qTipo?: string,
    @Query('dormitorios') qDormitorios?: string,
    @Query('valor_max') qValorMax?: string,
    @Query('vagas_min') qVagasMin?: string,
  ) {
    // Aceita os critérios tanto por query string quanto por header customizado
    // (headers X-* foram adicionados porque a plataforma RD Station remove
    // query strings ao salvar a Habilidade, mas preserva headers customizados)
    const bairro = xBairro || qBairro;
    const tipo = xTipo || qTipo;
    const dormitorios = xDormitorios || qDormitorios;
    const valorMax = xValorMax || qValorMax;
    const vagasMin = xVagasMin || qVagasMin;

    this.logger.log(
      `Requisição recebida — bairro=${bairro} tipo=${tipo} dormitorios=${dormitorios} valor_max=${valorMax} vagas_min=${vagasMin} temToken=${!!authHeader} origem=${xBairro || xTipo ? 'headers' : 'query'}`,
    );

    this.validarToken(authHeader, xApiToken);

    // Extrai o primeiro número de um texto livre (ex: "até 2500", "uns 2 mil",
    // "R$ 2.500,00") em vez de exigir que o campo seja só um número puro —
    // necessário porque as respostas vêm de perguntas abertas no fluxo,
    // e o cliente pode responder de formas variadas.
    const extrairNumero = (texto: string | undefined): number | undefined => {
      if (!texto) return undefined;
      const match = texto.replace(/\./g, '').match(/\d+/);
      return match ? Number(match[0]) : undefined;
    };

    const dormitoriosNum = extrairNumero(dormitorios);
    const valorMaxNum = extrairNumero(valorMax);
    const vagasMinNum = extrairNumero(vagasMin);

    const resultados = await this.imoveisService.buscar({
      bairro,
      tipo,
      dormitorios: dormitoriosNum,
      valorMax: valorMaxNum,
      vagasMin: vagasMinNum,
    });

    return { resultados };
  }

  private validarToken(authHeader: string | undefined, xApiToken: string | undefined) {
    const tokenEsperado = process.env.API_TOKEN;
    if (!tokenEsperado) {
      // trava por segurança: sem token configurado, nada responde
      this.logger.warn('API_TOKEN não configurado no servidor');
      throw new UnauthorizedException('API_TOKEN não configurado no servidor');
    }
    // Aceita o token tanto via "Authorization: Bearer ..." quanto via
    // header customizado "X-Api-Token" (usado porque o campo dedicado de
    // token da plataforma RD Station não persiste ao salvar a Habilidade)
    const tokenViaAuth = authHeader?.replace('Bearer ', '');
    const tokenRecebido = xApiToken || tokenViaAuth;
    if (tokenRecebido !== tokenEsperado) {
      this.logger.warn(`Token inválido recebido: authorization="${authHeader}" x-api-token="${xApiToken}"`);
      throw new UnauthorizedException('Token inválido');
    }
  }
}
