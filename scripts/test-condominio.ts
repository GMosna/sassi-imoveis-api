import { ScraperService, Imovel } from '../src/imoveis/scraper.service';

const svc = new ScraperService();

const called: string[] = [];
const orig = global.fetch;
(global as any).fetch = async (url: string) => {
  called.push(url);
  if (url.includes('/imovel-aluguel/999/')) {
    throw new Error('simulado network fail');
  }
  const body = url.includes('/12002/')
    ? `<html><body><div id="imovelExtra"><small>+ Condomínio R$ 450,00</small></div></body></html>`
    : `<html><body><div id="imovelExtra"><small>Valores sujeitos a alteração.</small></div></body></html>`;
  return new Response(body, { status: 200 });
};

const imoveis: Imovel[] = [
  { codigo: 1, tipo: 'APARTAMENTO', bairro: 'A', valor_locacao: 1000, valor_condominio: null, dormitorios: 2, vagas_garagem: 1, metragem: 50, link: 'https://x/imovel-aluguel/12001/a' },
  { codigo: 2, tipo: 'APARTAMENTO', bairro: 'A', valor_locacao: 2000, valor_condominio: null, dormitorios: 3, vagas_garagem: 2, metragem: 80, link: 'https://x/imovel-aluguel/12002/b' },
  { codigo: 3, tipo: 'CASA EM CONDOMINIO', bairro: 'A', valor_locacao: 3000, valor_condominio: null, dormitorios: 3, vagas_garagem: 2, metragem: 120, link: 'https://x/imovel-aluguel/12003/c' },
  { codigo: 4, tipo: 'CASA', bairro: 'A', valor_locacao: 1800, valor_condominio: null, dormitorios: 2, vagas_garagem: 1, metragem: 90, link: 'https://x/imovel-aluguel/12004/d' },
  { codigo: 5, tipo: 'KITNET', bairro: 'A', valor_locacao: 800, valor_condominio: null, dormitorios: 1, vagas_garagem: 0, metragem: 25, link: 'https://x/imovel-aluguel/12005/e' },
  { codigo: 6, tipo: 'SALA', bairro: 'A', valor_locacao: 1500, valor_condominio: null, dormitorios: null, vagas_garagem: 1, metragem: 40, link: 'https://x/imovel-aluguel/12006/f' },
  { codigo: 7, tipo: 'APARTAMENTO', bairro: 'A', valor_locacao: 1200, valor_condominio: null, dormitorios: 1, vagas_garagem: 0, metragem: 35, link: 'https://x/imovel-aluguel/999/fail' },
];

(async () => {
  await (svc as any).enriquecerComCondominio(imoveis);
  (global as any).fetch = orig;

  let failed = 0;
  const check = (label: string, ok: boolean) => {
    if (!ok) failed++;
    console.log(`${ok ? 'OK ' : 'FAIL'} ${label}`);
  };

  check('nenhum fetch para CASA (id 4)', !called.some((u) => u.includes('/12004/')));
  check('nenhum fetch para KITNET (id 5)', !called.some((u) => u.includes('/12005/')));
  check('nenhum fetch para SALA (id 6)', !called.some((u) => u.includes('/12006/')));
  check('fetch para APARTAMENTO (id 1)', called.some((u) => u.includes('/12001/')));
  check('fetch para APARTAMENTO (id 2)', called.some((u) => u.includes('/12002/')));
  check('fetch para CASA EM CONDOMINIO (id 3)', called.some((u) => u.includes('/12003/')));
  check('fetch para APARTAMENTO com falha (id 7)', called.some((u) => u.includes('/999/')));
  check('condominio 450 no id 2', imoveis[1].valor_condominio === 450);
  check('condominio null no id 1 (sem match)', imoveis[0].valor_condominio === null);
  check('condominio null no id 3 (sem match)', imoveis[2].valor_condominio === null);
  check('condominio null no id 4 (nao consultado)', imoveis[3].valor_condominio === null);
  check('condominio null no id 7 (falha isolada)', imoveis[6].valor_condominio === null);
  check('total de fetches = 4', called.length === 4);

  console.log(`\n${failed === 0 ? 'ALL PASS' : failed + ' FAILED'}`);
  process.exit(failed === 0 ? 0 : 1);
})();
