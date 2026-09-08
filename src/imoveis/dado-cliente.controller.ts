import {
  Controller,
  Get,
  Query,
  Headers,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';

/**
 * Rota auxiliar usada pelo fluxo do chatbot para gravar dados do cliente
 * no cadastro do contato (nome e telefone), que alimentam o CRM.
 *
 * O construtor de fluxo só permite a ação "Atualizar Nome/Contato com o @VALOR"
 * em nós de requisição externa — ela age sobre a RESPOSTA da API, não sobre a
 * resposta digitada pelo cliente. Por isso o fluxo envia o que a pessoa
 * respondeu para cá e esta rota devolve o valor já normalizado, para então
 * ser gravado no contato.
 */
@Controller('dado-cliente')
export class DadoClienteController {
  private readonly logger = new Logger(DadoClienteController.name);

  @Get()
  processar(
    @Headers('authorization') authHeader: string,
    @Headers('x-api-token') xApiToken: string | undefined,
    @Query('token') qToken?: string,
    @Query('valor') valor?: string,
    @Query('tipo') tipo?: string,
  ): { valor: string; valido: boolean } {
    this.validarToken(authHeader, xApiToken, qToken);

    const bruto = (valor ?? '').trim();
    const qual = (tipo ?? '').trim().toLowerCase();

    if (qual === 'telefone' || qual === 'celular') {
      const normalizado = normalizarTelefone(bruto);
      this.logger.log(`dado-cliente tipo=telefone valido=${normalizado !== null}`);
      return { valor: normalizado ?? bruto, valido: normalizado !== null };
    }

    const nome = normalizarNome(bruto);
    this.logger.log(`dado-cliente tipo=nome valido=${nome !== null}`);
    return { valor: nome ?? bruto, valido: nome !== null };
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

/** Mantém só dígitos e valida DDD + 8/9 dígitos. Retorna no formato 55DDDNUMERO. */
export function normalizarTelefone(entrada: string): string | null {
  let d = (entrada || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2); // tira DDI
  if (d.length === 10 || d.length === 11) {
    const ddd = Number(d.slice(0, 2));
    if (ddd < 11 || ddd > 99) return null;
    // celular com 9 digitos deve comecar com 9
    if (d.length === 11 && d[2] !== '9') return null;
    return '55' + d;
  }
  return null;
}

/** Title case simples, preservando conectivos em minúsculo. */
export function normalizarNome(entrada: string): string | null {
  const limpo = (entrada || '').replace(/\s+/g, ' ').trim();
  if (limpo.length < 2) return null;
  if (!/[a-zà-ú]/i.test(limpo)) return null;
  const minusculas = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
  return limpo
    .toLowerCase()
    .split(' ')
    .map((p, i) =>
      i > 0 && minusculas.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1),
    )
    .join(' ');
}
