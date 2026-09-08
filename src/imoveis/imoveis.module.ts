import { Module } from '@nestjs/common';
import { ImoveisController } from './imoveis.controller';
import { ImoveisService } from './imoveis.service';
import { ScraperService } from './scraper.service';
import { DadoClienteController } from './dado-cliente.controller';

@Module({
  controllers: [ImoveisController, DadoClienteController],
  providers: [ImoveisService, ScraperService],
})
export class ImoveisModule {}
