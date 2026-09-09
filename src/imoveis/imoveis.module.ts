import { Module } from '@nestjs/common';
import { ImoveisController } from './imoveis.controller';
import { ImoveisService } from './imoveis.service';
import { ScraperService } from './scraper.service';
import { DadoClienteController } from './dado-cliente.controller';
import { LeadController } from './lead.controller';

@Module({
  controllers: [ImoveisController, DadoClienteController, LeadController],
  providers: [ImoveisService, ScraperService],
})
export class ImoveisModule {}
