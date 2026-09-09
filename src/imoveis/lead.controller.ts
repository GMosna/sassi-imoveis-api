import {
  Controller,
  Get,
  Query,
  Headers,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { normalizarTelefone, normalizarEmail, normalizarNome } from './dado-cliente.controller';

/** Destinos no RD Station CRM — mesmos usados pelo fluxo Comercial-oficial. */
const FUNIL_LOCACAO = '66eaadbee736e20026d75b62';   // Locação - Beta
const ETAPA_ATENDIMENTO = '66eaadbee736e20026d75b65'; // Atendimento
const RESPONSAVEL_SDR = '63456e30196d48000e02eb0c';   // SDR Locação

interface ResultadoLead {
  registrado: boolean;
  motivo?: string;
  deal_id?: string;
}

@Controller('registrar-lead')
export class LeadController {
  private readonly logger = new Logger(LeadController.name);

  @Get()
  async registrar(
    @Headers('authorization') authHeader: string,
    @Headers('x-api-token') xApiToken: string | undefined,
    @Query('token') qToken?: string,
    @Query('nome') nome?: string,
    @Query('telefone') telefone?: string,
    @Query('email') email?: string,
    @Query('interesse') interesse?: string,
  ): Promise<ResultadoLead> {
    this.validarToken(authHeader, xApiToken, qToken);

    const nomeLimpo = normalizarNome(nome || '');
    const telLimpo = normalizarTelefone(telefone || '');
    const emailLimpo = normalizarEmail(email || '');

    // Nome é o mínimo para criar uma negociação identificável
    if (!nomeLimpo) {
      this.logger.warn('registrar-lead sem nome válido — não registrado');
      return { registrado: false, motivo: 'nome ausente ou inválido' };
    }

    const tokenCrm = process.env.RDCRM_TOKEN;
    if (!tokenCrm) {
      this.logger.warn('RDCRM_TOKEN não configurado — lead não registrado');
      return { registrado: false, motivo: 'RDCRM_TOKEN não configurado' };
    }

    const contato: Record<string, unknown> = { name: nomeLimpo };
    if (emailLimpo) contato.emails = [{ email: emailLimpo }];
    if (telLimpo) contato.phones = [{ phone: telLimpo, type: 'cellphone' }];

    const corpo = {
      deal: {
        name: `${nomeLimpo} — Locação (IA)`,
        deal_stage_id: ETAPA_ATENDIMENTO,
        user_id: RESPONSAVEL_SDR,
        rating: 1,
      },
      contacts: [contato],
      distribution_settings: { type: 'sequential' },
    };

    try {
      const resp = await fetch(
        `https://crm.rdstation.com/api/v1/deals?token=${encodeURIComponent(tokenCrm)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(corpo),
          signal: AbortSignal.timeout(10000),
        },
      );

      if (!resp.ok) {
        const texto = await resp.text().catch(() => '');
        this.logger.error(
          `RD CRM recusou o lead (HTTP ${resp.status}): ${texto.slice(0, 300)}`,
        );
        return { registrado: false, motivo: `CRM respondeu ${resp.status}` };
      }

      const dados: any = await resp.json();
      this.logger.log(
        `Lead registrado: ${nomeLimpo} | tel=${!!telLimpo} email=${!!emailLimpo} | deal=${dados?._id || dados?.id}`,
      );
      return { registrado: true, deal_id: dados?._id || dados?.id };
    } catch (err) {
      this.logger.error(`Falha ao registrar lead: ${err}`);
      return { registrado: false, motivo: 'falha de comunicação com o CRM' };
    }
  }

  private validarToken(
    authHeader: string | undefined,
    xApiToken: string | undefined,
    qToken: string | undefined,
  ) {
    const tokenEsperado = process.env.API_TOKEN;
    if (!tokenEsperado) {
      throw new UnauthorizedException('API_TOKEN não configurado no servidor');
    }
    const tokenViaAuth = authHeader?.replace('Bearer ', '');
    const tokenRecebido = qToken || xApiToken || tokenViaAuth;
    if (tokenRecebido !== tokenEsperado) {
      throw new UnauthorizedException('Token inválido');
    }
  }
}
