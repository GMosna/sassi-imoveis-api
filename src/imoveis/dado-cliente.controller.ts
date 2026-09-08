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

    if (qual === 'email' || qual === 'e-mail') {
      const normalizado = normalizarEmail(bruto);
      this.logger.log(`dado-cliente tipo=email valido=${normalizado !== null}`);
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

/**
 * Extrai e normaliza um telefone brasileiro escrito de qualquer jeito.
 * Aceita frases inteiras ("meu whats é (19) 99778-0680, pode chamar"),
 * qualquer separador (espaço, hífen, ponto, barra, parênteses) e DDI opcional.
 * Retorna no formato 55DDDNUMERO.
 */
export function normalizarTelefone(entrada: string): string | null {
  const texto = entrada || '';

  // 1) tenta achar um trecho com cara de telefone dentro do texto
  const candidatos: string[] = [];
  const padrao = /(?:\+?\s*55[\s.\-]*)?(?:\(?\s*\d{2}\s*\)?[\s.\-]*)?\d[\d\s.\-]{7,14}\d/g;
  for (const m of texto.matchAll(padrao)) candidatos.push(m[0]);

  // 2) fallback: todos os digitos do texto
  candidatos.push(texto);

  for (const c of candidatos) {
    const r = digitosParaTelefone(c.replace(/\D/g, ''));
    if (r) return r;
  }
  return null;
}

/** Valida a sequencia de digitos (com ou sem DDI 55) e devolve 55DDDNUMERO. */
function digitosParaTelefone(d: string): string | null {
  if (!d) return null;

  // remove DDI quando o resto continua com tamanho de telefone
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);
  // alguns digitam 0 antes do DDD (0 19 99999-8888)
  if (d.startsWith('0') && (d.length === 11 || d.length === 12)) d = d.slice(1);

  if (d.length !== 10 && d.length !== 11) return null;

  const ddd = Number(d.slice(0, 2));
  if (ddd < 11 || ddd > 99) return null;

  // celular (11 digitos) tem que comecar com 9; fixo (10) comeca de 2 a 5
  if (d.length === 11 && d[2] !== '9') return null;
  if (d.length === 10 && !'2345'.includes(d[2])) return null;

  return '55' + d;
}

/** Valida e normaliza e-mail (minusculo, sem espaços, extrai de dentro de frases). */
export function normalizarEmail(entrada: string): string | null {
  const texto = (entrada || '').trim();
  if (!texto) return null;
  const m = texto
    .replace(/\s+/g, ' ')
    .match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  if (!m) return null;
  const email = m[0].toLowerCase().replace(/[.,;]+$/, '');
  if (email.length > 254) return null;
  return email;
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
