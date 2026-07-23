import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ImoveisModule } from './imoveis/imoveis.module';

@Module({
  imports: [ScheduleModule.forRoot(), ImoveisModule],
})
export class AppModule {}
