import { Module } from '@nestjs/common';
import { ImoveisController } from './imoveis.controller';
import { ImoveisService } from './imoveis.service';
import { ScraperService } from './scraper.service';

@Module({
  controllers: [ImoveisController],
  providers: [ImoveisService, ScraperService],
})
export class ImoveisModule {}
