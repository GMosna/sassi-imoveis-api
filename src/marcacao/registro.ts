import { promises as fs } from 'fs';
import { Modo } from './config';
import { TipoEntrada } from './classificador';

/**
 * Registro da marcação em disco (/data no Railway, que sobrevive a reinícios):
 * quais negociações já foram processadas e as últimas decisões, para a rota de
 * acompanhamento. Não guarda nome, telefone nem e-mail de cliente.
 */

export interface Decisao {
  em: string;
  negociacao: string;
  funil: string;
  modo: Modo;
  tipo: TipoEntrada | null;
  /** gravou | simulou | nada gravado | erro */
  acao: 'gravou' | 'simulou' | 'nada gravado' | 'erro';
  campo: 'gravado' | 'já preenchido' | 'não gravado';
  tarefa: 'criada' | 'já existia' | 'não criada' | 'não se aplica';
  /** IDs das negociações anteriores encontradas. */
  anteriores: string[];
  observacao?: string;
}

/** Gravação suspensa: guardada em disco para continuar suspensa depois de reiniciar. */
export interface Disjuntor {
  motivo: string;
  em: string;
}

const MAXIMO_DECISOES = 200;

export class Registro {
  private processadas = new Map<string, string>();
  private decisoes: Decisao[] = [];
  private _disjuntor: Disjuntor | null = null;
  private fila: Promise<void> = Promise.resolve();

  constructor(
    private readonly arquivo: string,
    private readonly avisar: (mensagem: string) => void = () => undefined,
  ) {}

  /**
   * Lê o registro. Sem arquivo é a primeira execução. Arquivo que existe mas
   * não dá para ler: não há como saber se a gravação estava suspensa, então
   * ela fica suspensa (uma cópia do arquivo é guardada para análise).
   */
  async carregar(): Promise<void> {
    let conteudo: string;
    try {
      conteudo = await fs.readFile(this.arquivo, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return;
      this.suspenderPorRegistroIlegivel();
      return;
    }
    try {
      const dados = JSON.parse(conteudo);
      if (!dados || typeof dados !== 'object' || Array.isArray(dados)) throw new Error('formato inesperado');
      if (Array.isArray(dados.processadas)) this.processadas = new Map(dados.processadas);
      if (Array.isArray(dados.decisoes)) this.decisoes = dados.decisoes.slice(0, MAXIMO_DECISOES);
      if (dados.disjuntor && typeof dados.disjuntor.motivo === 'string') this._disjuntor = dados.disjuntor;
    } catch {
      try {
        await fs.copyFile(this.arquivo, `${this.arquivo}.ilegivel`);
      } catch {
        // sem cópia
      }
      this.suspenderPorRegistroIlegivel();
    }
  }

  private suspenderPorRegistroIlegivel(): void {
    this._disjuntor = { motivo: 'o registro da marcação em disco estava ilegível', em: new Date().toISOString() };
    this.avisar('registro da marcação ilegível: gravação suspensa até liberar em POST /marcacao/religar');
  }

  /** Uma gravação de cada vez, para duas nunca usarem o mesmo arquivo temporário. */
  salvar(): Promise<void> {
    const minhaVez = this.fila.then(() => this.salvarAgora());
    this.fila = minhaVez.catch(() => undefined);
    return minhaVez;
  }

  /** Grava em arquivo temporário e renomeia, para nunca deixar o registro pela metade. */
  private async salvarAgora(): Promise<void> {
    const temporario = `${this.arquivo}.tmp`;
    try {
      const conteudo = JSON.stringify({
        processadas: Array.from(this.processadas.entries()),
        decisoes: this.decisoes,
        disjuntor: this._disjuntor,
      });
      await fs.writeFile(temporario, conteudo, 'utf-8');
      await fs.rename(temporario, this.arquivo);
    } catch (err) {
      this.avisar(`não consegui salvar o registro da marcação: ${err instanceof Error ? err.message : err}`);
    }
  }

  get disjuntor(): Disjuntor | null {
    return this._disjuntor;
  }

  definirDisjuntor(disjuntor: Disjuntor | null): void {
    this._disjuntor = disjuntor;
  }

  jaProcessada(id: string): boolean {
    return this.processadas.has(id);
  }

  marcarProcessada(id: string, quando: Date): void {
    this.processadas.set(id, quando.toISOString());
  }

  anotar(decisao: Decisao): void {
    this.decisoes.unshift(decisao);
    if (this.decisoes.length > MAXIMO_DECISOES) this.decisoes.length = MAXIMO_DECISOES;
  }

  ultimas(quantidade = 50): Decisao[] {
    return this.decisoes.slice(0, quantidade);
  }

  /** Esquece negociações processadas antes da data (a consulta só olha 24 h). */
  esquecerAntesDe(limite: Date): void {
    for (const [id, quando] of this.processadas) {
      if (Date.parse(quando) < limite.getTime()) this.processadas.delete(id);
    }
  }

  totalProcessadas(): number {
    return this.processadas.size;
  }
}
