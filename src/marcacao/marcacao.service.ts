import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import { lerConfig } from './config';
import { ClienteCrm } from './crm.client';
import { Marcador } from './marcador';
import { Registro } from './registro';

/**
 * Liga a marcação ao ciclo de vida da API. Uma rodada por vez: a próxima só é
 * agendada quando a anterior termina. Qualquer erro fica preso aqui dentro,
 * para nunca derrubar a busca de imóveis nem o resto da API.
 */
@Injectable()
export class MarcacaoService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('MarcacaoLeads');
  private readonly cfg = lerConfig(process.env);
  private readonly registro = new Registro(this.cfg.arquivoRegistro, (m) => this.logger.warn(m));
  private readonly arquivoHistorico = path.join(path.dirname(this.cfg.arquivoRegistro), 'marcacao-historico.json');
  private marcador: Marcador | null = null;
  private timer: NodeJS.Timeout | null = null;
  private encerrando = false;
  private rodando = false;

  async onModuleInit(): Promise<void> {
    try {
      for (const problema of this.cfg.problemas) this.logger.warn(`configuração: ${problema}`);
      if (this.cfg.modo === 'desligado') {
        this.logger.log('marcação de leads desligada');
        return;
      }
      await this.registro.carregar();
      this.marcador = new Marcador(this.cfg, new ClienteCrm(this.cfg.token), this.registro, {
        info: (m) => this.logger.log(m),
        aviso: (m) => this.logger.warn(m),
        erro: (m) => this.logger.error(m),
      });
      this.logger.log(
        `marcação de leads em modo ${this.cfg.modo}: consulta a cada ${this.cfg.intervaloMinutos} min, ` +
          `espera de ${this.cfg.esperaMinutos} min pela roleta`,
      );
      // Primeira rodada 1 minuto depois de subir, para não pesar no início
      this.agendar(60_000);
    } catch (err) {
      this.marcador = null;
      this.logger.error(`marcação não iniciou: ${err instanceof Error ? err.message : err}`);
    }
  }

  onModuleDestroy(): void {
    this.encerrando = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private agendar(ms: number): void {
    if (this.encerrando) return;
    this.timer = setTimeout(() => void this.executar(), ms);
  }

  private async executar(): Promise<void> {
    if (this.rodando || !this.marcador) return;
    this.rodando = true;
    try {
      await this.marcador.rodada();
    } catch (err) {
      this.logger.error(`rodada da marcação falhou: ${err instanceof Error ? err.message : err}`);
    } finally {
      this.rodando = false;
      this.agendar(this.cfg.intervaloMinutos * 60_000);
    }
  }

  /**
   * Começa a leitura do histórico em segundo plano (só leitura, nada é gravado
   * no CRM). O resultado fica em memória e em disco, ao lado do registro.
   */
  iniciarHistorico(dias: number): { iniciado: boolean; motivo?: string } {
    if (!this.marcador) return { iniciado: false, motivo: 'a marcação está desligada' };
    if (this.marcador.historico?.rodando) return { iniciado: false, motivo: 'a leitura do histórico já está rodando' };
    const marcador = this.marcador;
    void marcador
      .lerHistorico(dias)
      .then((estado) => fs.writeFile(this.arquivoHistorico, JSON.stringify(estado), 'utf-8'))
      .catch((err) => this.logger.error(`leitura do histórico falhou: ${err instanceof Error ? err.message : err}`));
    return { iniciado: true };
  }

  /** Libera a gravação depois de um alerta, quando alguém já conferiu o CRM. */
  async religar(): Promise<{ religado: boolean; motivo?: string }> {
    if (!this.marcador) return { religado: false, motivo: 'a marcação está desligada' };
    const religou = await this.marcador.religar();
    return religou ? { religado: true } : { religado: false, motivo: 'a gravação não estava suspensa' };
  }

  async historico(): Promise<unknown> {
    if (this.marcador?.historico) return this.marcador.historico;
    try {
      return JSON.parse(await fs.readFile(this.arquivoHistorico, 'utf-8'));
    } catch {
      return null;
    }
  }

  /** Estado para a rota de acompanhamento. Sem token e sem dados de clientes. */
  status() {
    return {
      modo: this.cfg.modo,
      problemasDeConfiguracao: this.cfg.problemas,
      intervaloMinutos: this.cfg.intervaloMinutos,
      esperaMinutos: this.cfg.esperaMinutos,
      gravacaoSuspensa: this.registro.disjuntor,
      rodando: this.rodando,
      historicoRodando: this.marcador?.historico?.rodando ?? false,
      ultimaRodada: this.marcador?.ultimaRodada ?? null,
      negociacoesNoRegistro: this.registro.totalProcessadas(),
      decisoes: this.registro.ultimas(50),
    };
  }
}
