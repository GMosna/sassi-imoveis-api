import { BadRequestException, Controller, Get, Headers, Post, Query, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { MarcacaoService } from './marcacao.service';

/**
 * Rotas de acompanhamento da marcação, protegidas pelo mesmo API_TOKEN das
 * outras rotas. Nenhuma delas grava no CRM.
 *   GET  /marcacao                    -> modo, última rodada e últimas 50 decisões
 *   POST /marcacao/historico?dias=30  -> começa a leitura do histórico (só leitura)
 *   GET  /marcacao/historico          -> andamento e resultado da leitura do histórico
 */
@Controller('marcacao')
export class MarcacaoController {
  constructor(private readonly marcacao: MarcacaoService) {}

  @Get()
  status(
    @Headers('authorization') authHeader: string | undefined,
    @Headers('x-api-token') xApiToken: string | undefined,
    @Query('token') qToken?: string,
  ) {
    validarToken(authHeader, xApiToken, qToken);
    return this.marcacao.status();
  }

  @Post('historico')
  iniciarHistorico(
    @Headers('authorization') authHeader: string | undefined,
    @Headers('x-api-token') xApiToken: string | undefined,
    @Query('token') qToken?: string,
    @Query('dias') dias?: string,
  ) {
    validarToken(authHeader, xApiToken, qToken);
    const n = dias === undefined ? 30 : Number(dias);
    if (!Number.isInteger(n) || n < 1 || n > 90) throw new BadRequestException('dias deve ser um número inteiro de 1 a 90');
    return this.marcacao.iniciarHistorico(n);
  }

  @Get('historico')
  historico(
    @Headers('authorization') authHeader: string | undefined,
    @Headers('x-api-token') xApiToken: string | undefined,
    @Query('token') qToken?: string,
  ) {
    validarToken(authHeader, xApiToken, qToken);
    return this.marcacao.historico();
  }
}

function validarToken(authHeader: string | undefined, xApiToken: string | undefined, qToken: string | undefined) {
  const esperado = process.env.API_TOKEN;
  if (!esperado) throw new UnauthorizedException('API_TOKEN não configurado no servidor');
  const recebido = qToken || xApiToken || authHeader?.replace('Bearer ', '') || '';
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException('Token inválido');
}
