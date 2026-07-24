import {
  Controller,
  Get,
  Query,
  Headers,
  UnauthorizedException,
  BadRequestException,
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
    const bairro = xBairro || qBairro;
    const tipo = xTipo || qTipo;
    const dormitorios = xDormitorios || qDormitorios;
    const valorMax = xValorMax || qValorMax;
    const vagasMin = xVagasMin || qVagasMin;

    this.logger.log(
      `Requisição recebida — bairro=${bairro} tipo=${tipo} dormitorios=${dormitorios} valor_max=${valorMax} vagas_min=${vagasMin} temToken=${!!(authHeader || xApiToken)} origem=${xBairro || xTipo ? 'headers' : 'query'}`,
    );

    this.validarToken(authHeader, xApiToken);

    const dormitoriosNum = dormitorios ? Number(dormitorios) : undefined;
    if (dormitorios !== undefined && Number.isNaN(dormitoriosNum)) {
      throw new BadRequestException('dormitorios precisa ser um número');
    }

    const valorMaxNum = valorMax ? Number(valorMax) : undefined;
    if (valorMax !== undefined && Number.isNaN(valorMaxNum)) {
      throw new BadRequestException('valor_max precisa ser um número');
    }

    const vagasMinNum = vagasMin ? Number(vagasMin) : undefined;
    if (vagasMin !== undefined && Number.isNaN(vagasMinNum)) {
      throw new BadRequestException('vagas_min precisa ser um número');
    }

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
      this.logger.warn('API_TOKEN não configurado no servidor');
      throw new UnauthorizedException('API_TOKEN não configurado no servidor');
    }
    const tokenRecebido = xApiToken ?? authHeader?.replace('Bearer ', '');
    if (tokenRecebido !== tokenEsperado) {
      this.logger.warn(`Token inválido recebido: "${xApiToken ?? authHeader}"`);
      throw new UnauthorizedException('Token inválido');
    }
  }
}
