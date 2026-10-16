import { Module } from '@nestjs/common';
import { MarcacaoController } from './marcacao.controller';
import { MarcacaoService } from './marcacao.service';

/** Marcação de leads de retorno no RD CRM. Desligada enquanto MARCACAO_MODO não for definido. */
@Module({
  controllers: [MarcacaoController],
  providers: [MarcacaoService],
})
export class MarcacaoModule {}
