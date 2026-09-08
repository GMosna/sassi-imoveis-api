import { ImoveisService } from '../src/imoveis/imoveis.service';

const cache = [
  { codigo: 1, tipo: 'Apartamento', bairro: 'A', valor_locacao: 1000, dormitorios: 1, vagas_garagem: 0, metragem: null, link: '' },
  { codigo: 2, tipo: 'Apartamento', bairro: 'A', valor_locacao: 1500, dormitorios: 2, vagas_garagem: 1, metragem: null, link: '' },
  { codigo: 3, tipo: 'Apartamento', bairro: 'A', valor_locacao: 2000, dormitorios: 3, vagas_garagem: 2, metragem: null, link: '' },
  { codigo: 4, tipo: 'Apartamento', bairro: 'A', valor_locacao: 900, dormitorios: null, vagas_garagem: 0, metragem: null, link: '' },
];

delete process.env.USE_MOCK_DATA;
const svc = new ImoveisService({ getCache: () => cache } as any);

let failed = 0;
async function run(label: string, filtro: any, expectedCodigos: number[]) {
  const res = await svc.buscar(filtro);
  const codigos = res.map((r: any) => r.codigo).sort();
  const ok = JSON.stringify(codigos) === JSON.stringify(expectedCodigos.slice().sort());
  if (!ok) failed++;
  console.log(`${ok ? 'OK ' : 'FAIL'} ${label} → [${codigos.join(',')}] | esperado: [${expectedCodigos.join(',')}]`);
}

(async () => {
  await run('{dormitorios: 1}', { dormitorios: 1 }, [1, 2, 3]);
  await run('{dormitorios: 2}', { dormitorios: 2 }, [2, 3]);
  await run('{dormitorios: 1, exato: true}', { dormitorios: 1, dormitoriosExato: true }, [1]);
  await run('{dormitorios: 2, exato: true}', { dormitorios: 2, dormitoriosExato: true }, [2]);
  await run('{dormitorios: 3, exato: true}', { dormitorios: 3, dormitoriosExato: true }, [3]);
  await run('{dormitorios: 2, exato: false}', { dormitorios: 2, dormitoriosExato: false }, [2, 3]);
  await run('{}', {}, [1, 2, 3, 4]);
  await run('{dormitorios: 1} (null excluido)', { dormitorios: 1 }, [1, 2, 3]);
  console.log(`\n${failed === 0 ? 'ALL PASS' : failed + ' FAILED'}`);
  process.exit(failed === 0 ? 0 : 1);
})();
