import {
  Controller,
  Get,
  Query,
  Headers,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { ImoveisService } from './imoveis.service';

@Controller('imoveis-disponiveis')
export class ImoveisController {
  constructor(private readonly imoveisService: ImoveisService) {}

  @Get()
  async buscar(
    @Headers('authorization') authHeader: string,
    @Query('bairro') bairro?: string,
    @Query('tipo') tipo?: string,
    @Query('dormitorios') dormitorios?: string,
    @Query('valor_max') valorMax?: string,
  ) {
    this.validarToken(authHeader);

    const dormitoriosNum = dormitorios ? Number(dormitorios) : undefined;
    if (dormitorios !== undefined && Number.isNaN(dormitoriosNum)) {
      throw new BadRequestException('dormitorios precisa ser um número');
    }

    const valorMaxNum = valorMax ? Number(valorMax) : undefined;
    if (valorMax !== undefined && Number.isNaN(valorMaxNum)) {
      throw new BadRequestException('valor_max precisa ser um número');
    }

    const resultados = await this.imoveisService.buscar({
      bairro,
      tipo,
      dormitorios: dormitoriosNum,
      valorMax: valorMaxNum,
    });

    return { resultados };
  }

  private validarToken(authHeader: string | undefined) {
    const tokenEsperado = process.env.API_TOKEN;
    if (!tokenEsperado) {
      // trava por segurança: sem token configurado, nada responde
      throw new UnauthorizedException('API_TOKEN não configurado no servidor');
    }
    const tokenRecebido = authHeader?.replace('Bearer ', '');
    if (tokenRecebido !== tokenEsperado) {
      throw new UnauthorizedException('Token inválido');
    }
  }
}
