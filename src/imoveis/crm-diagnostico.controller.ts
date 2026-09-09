import {
  Controller,
  Get,
  Query,
  Headers,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';

/**
 * Rota TEMPORÁRIA de diagnóstico: lista funis, etapas e usuários da conta
 * do RD Station CRM associada ao RDCRM_TOKEN configurado.
 *
 * Serve para descobrir os IDs corretos a usar em /registrar-lead.
 * Deve ser removida depois que a integração estiver configurada.
 */
@Controller('crm-diagnostico')
export class CrmDiagnosticoController {
  private readonly logger = new Logger(CrmDiagnosticoController.name);

  @Get()
  async diagnosticar(
    @Headers('authorization') authHeader: string,
    @Headers('x-api-token') xApiToken: string | undefined,
    @Query('token') qToken?: string,
  ): Promise<Record<string, unknown>> {
    this.validarToken(authHeader, xApiToken, qToken);

    const tokenCrm = process.env.RDCRM_TOKEN;
    if (!tokenCrm) return { erro: 'RDCRM_TOKEN não configurado' };

    const buscar = async (caminho: string) => {
      try {
        const r = await fetch(
          `https://crm.rdstation.com/api/v1/${caminho}?token=${encodeURIComponent(tokenCrm)}`,
          { signal: AbortSignal.timeout(10000) },
        );
        if (!r.ok) return { erro: `HTTP ${r.status}`, corpo: (await r.text()).slice(0, 200) };
        return await r.json();
      } catch (err) {
        return { erro: String(err) };
      }
    };

    const [conta, funis, etapas, usuarios] = await Promise.all([
      buscar('token/check'),
      buscar('deal_pipelines'),
      buscar('deal_stages'),
      buscar('users'),
    ]);

    // devolve apenas id e nome, para a resposta ficar legível
    const resumir = (dados: any, chave?: string) => {
      const lista = Array.isArray(dados) ? dados : chave ? dados?.[chave] : dados;
      if (!Array.isArray(lista)) return dados;
      return lista.map((x: any) => ({
        id: x?.id || x?._id,
        nome: x?.name,
        funil: x?.deal_pipeline_id || x?.deal_pipeline?.name,
      }));
    };

    return {
      conta,
      funis: resumir(funis, 'deal_pipelines'),
      etapas: resumir(etapas, 'deal_stages'),
      usuarios: resumir(usuarios, 'users'),
    };
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
