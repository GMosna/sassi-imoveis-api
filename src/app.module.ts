import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ImoveisModule } from './imoveis/imoveis.module';
import { MarcacaoModule } from './marcacao/marcacao.module';

@Module({
  imports: [ScheduleModule.forRoot(), ImoveisModule, MarcacaoModule],
})
export class AppModule {}
