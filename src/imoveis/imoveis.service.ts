import { Injectable, OnModuleDestroy } from '@nestjs/common';
import * as mysql from 'mysql2/promise';

export interface FiltroImoveis {
  bairro?: string;
  tipo?: string;
  dormitorios?: number;
  valorMax?: number;
}

const IMOVEIS_MOCK = [
  {
    codigo: 1001,
    foto: 'https://sassiimoveis.com.br/fotos/1001.jpg',
    valor_locacao: 1650,
    valor_condominio: 380,
    tipo: 'Apartamento',
    tipo_logradouro: 'Rua',
    endereco: 'Coronel Quirino',
    numero: '500',
    complemento: 'Apto 42',
    bairro: 'Cambuí',
    cidade: 'Limeira',
    dormitorios: 2,
    vagas_garagem: 1,
    iptu_cadastrado: 90,
    ultimo_ano_iptu: 2026,
    ultimo_valor_iptu: 95,
  },
  {
    codigo: 2002,
    foto: 'https://sassiimoveis.com.br/fotos/2002.jpg',
    valor_locacao: 2400,
    valor_condominio: 450,
    tipo: 'Casa em Condomínio',
    tipo_logradouro: 'Rua',
    endereco: 'das Palmeiras',
    numero: '120',
    complemento: null,
    bairro: 'Jardim Nova Europa',
    cidade: 'Limeira',
    dormitorios: 3,
    vagas_garagem: 2,
    iptu_cadastrado: 150,
    ultimo_ano_iptu: 2026,
    ultimo_valor_iptu: 155,
  },
  {
    codigo: 1003,
    foto: 'https://sassiimoveis.com.br/fotos/1003.jpg',
    valor_locacao: 1200,
    valor_condominio: 320,
    tipo: 'Apartamento',
    tipo_logradouro: 'Rua',
    endereco: 'Marechal Deodoro',
    numero: '210',
    complemento: null,
    bairro: 'Cambuí',
    cidade: 'Limeira',
    dormitorios: 1,
    vagas_garagem: 1,
    iptu_cadastrado: 60,
    ultimo_ano_iptu: 2026,
    ultimo_valor_iptu: 62,
  },
];

@Injectable()
export class ImoveisService implements OnModuleDestroy {
  private pool: mysql.Pool | null = null;
  private readonly useMock: boolean;

  constructor() {
    this.useMock = process.env.USE_MOCK_DATA === 'true';

    if (!this.useMock) {
      this.pool = mysql.createPool({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT) || 3306,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        waitForConnections: true,
        connectionLimit: 5,
      });
    } else {
      console.log('[ImoveisService] USE_MOCK_DATA=true — respondendo com dados fictícios, sem consultar o banco.');
    }
  }

  async buscar(filtro: FiltroImoveis) {
    if (this.useMock) {
      return this.buscarMock(filtro);
    }
    return this.buscarNoBanco(filtro);
  }

  private buscarMock(filtro: FiltroImoveis) {
    return IMOVEIS_MOCK.filter((im) => {
      if (filtro.bairro && !im.bairro.toLowerCase().includes(filtro.bairro.toLowerCase())) return false;
      if (filtro.tipo && !im.tipo.toLowerCase().includes(filtro.tipo.toLowerCase())) return false;
      if (filtro.dormitorios !== undefined && im.dormitorios !== filtro.dormitorios) return false;
      if (filtro.valorMax !== undefined && im.valor_locacao > filtro.valorMax) return false;
      return true;
    });
  }

  private async buscarNoBanco(filtro: FiltroImoveis) {
    const condicoesExtras: string[] = [];
    const valores: any[] = [];

    if (filtro.bairro) {
      condicoesExtras.push(`bairro.bairro LIKE ?`);
      valores.push(`%${filtro.bairro}%`);
    }
    if (filtro.tipo) {
      condicoesExtras.push(`tipo.tipo LIKE ?`);
      valores.push(`%${filtro.tipo}%`);
    }
    if (filtro.dormitorios !== undefined) {
      condicoesExtras.push(`quadro.quarto = ?`);
      valores.push(filtro.dormitorios);
    }
    if (filtro.valorMax !== undefined) {
      condicoesExtras.push(`quadro.aluguel <= ?`);
      valores.push(filtro.valorMax);
    }

    const extra = condicoesExtras.length ? `AND ${condicoesExtras.join(' AND ')}` : '';

    // Query base fornecida pelo Reginaldo (mesma lógica usada no site),
    // com os filtros do agente adicionados como condições extras no WHERE.
    const query = `
      SELECT
        quadro.seq_quadro,
        URLFotos(quadro.IDSite, tipo.tipo, bairro.bairro) as URLFotos,
        quadro.aluguel,
        quadro.condominio,
        tipo.tipo,
        tipo_logradouro.descricao as TipoLogradouro,
        quadro.endereco,
        quadro.complemento,
        bairro.bairro,
        cid.nome as cidade,
        quadro.quarto,
        quadro.numero_vagas_garagem,
        quadro.iptu,
        iptumes.ano as UltimoAnoIPTU,
        iptumes.valor_inqu as UltimoValorIPTU
      FROM quadro
      LEFT JOIN tipo ON tipo.seq_tipo = quadro.seq_tipo
      LEFT JOIN bairro ON bairro.seq_bairro = quadro.seq_bairro
      LEFT JOIN tipo_logradouro ON tipo_logradouro.seq_tipo_logradouro = quadro.seq_tipo_logradouro
      LEFT JOIN cid ON cid.seq_cid = quadro.seq_cid
      LEFT JOIN iptumes ON iptumes.seq_iptumes = (
          SELECT iptu2.seq_iptumes
          FROM iptumes iptu2
          WHERE iptu2.seq_quadro = quadro.seq_quadro
          ORDER BY iptu2.ano DESC, iptu2.mes DESC, iptu2.seq_iptumes DESC
          LIMIT 1
      )
      WHERE quadro.esta_no_quadro = 1
        AND quadro.site = 'S'
        ${extra}
      ORDER BY quadro.aluguel ASC
      LIMIT 10
    `;

    const [rows] = await this.pool!.query(query, valores);
    return (rows as any[]).map((r) => ({
      codigo: r.seq_quadro,
      foto: r.URLFotos,
      valor_locacao: r.aluguel,
      valor_condominio: r.condominio,
      tipo: r.tipo,
      tipo_logradouro: r.TipoLogradouro,
      endereco: r.endereco,
      complemento: r.complemento,
      bairro: r.bairro,
      cidade: r.cidade,
      dormitorios: r.quarto,
      vagas_garagem: r.numero_vagas_garagem,
      iptu_cadastrado: r.iptu,
      ultimo_ano_iptu: r.UltimoAnoIPTU,
      ultimo_valor_iptu: r.UltimoValorIPTU,
    }));
  }

  async onModuleDestroy() {
    if (this.pool) {
      await this.pool.end();
    }
  }
}
