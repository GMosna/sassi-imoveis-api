import { Module } from '@nestjs/common';
import { ImoveisModule } from './imoveis/imoveis.module';

@Module({
  imports: [ImoveisModule],
})
export class AppModule {}
