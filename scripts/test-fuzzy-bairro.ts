import { filtrarPorBairro, levenshtein, fuzzyContains, bairroThreshold, tipoCombina } from '../src/imoveis/imoveis.service';

const cache = [
  { bairro: 'Jardim São Paulo', codigo: 1 },
  { bairro: 'Jardim Nova Europa', codigo: 2 },
  { bairro: 'Vila Cristovam', codigo: 3 },
  { bairro: 'Vila Cristina', codigo: 4 },
  { bairro: 'Cambuí', codigo: 5 },
  { bairro: 'Jd. Chapadão', codigo: 6 },
  { bairro: 'Parque Prado', codigo: 7 },
  { bairro: 'Centro', codigo: 8 },
  { bairro: 'CHACARA ANTONIETA', codigo: 9 },
];

let failed = 0;

function runBairro(query: string, expected: string) {
  const res = filtrarPorBairro(cache, query);
  const bairros = res.map((r) => r.bairro).join(', ') || '(vazio)';
  const ok = expected === '*' ? true : bairros === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'OK ' : 'FAIL'} bairro=${JSON.stringify(query)} → ${bairros} | esperado: ${expected}`);
}

function runTipo(tipoImovel: string, tipoBusca: string, expected: boolean) {
  const got = tipoCombina(tipoImovel, tipoBusca);
  const ok = got === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'OK ' : 'FAIL'} tipoCombina(${JSON.stringify(tipoImovel)}, ${JSON.stringify(tipoBusca)}) = ${got} | esperado: ${expected}`);
}

console.log('--- casos originais ---');
runBairro('jardim sao pailo', 'Jardim São Paulo');
runBairro('jardim sao paulo', 'Jardim São Paulo');
runBairro('vila cristovam', 'Vila Cristovam');
runBairro('xyzabc123', '(vazio)');
runBairro('vila cristina', 'Vila Cristina');
runBairro('cambui', 'Cambuí');
runBairro('cambuii', 'Cambuí');
runBairro('centro', 'Centro');
runBairro('jardin sao paulo', 'Jardim São Paulo');
runBairro('jd sao paulo', 'Jardim São Paulo');
runBairro('nova europa', 'Jardim Nova Europa');
runBairro('chapadao', 'Jd. Chapadão');
runBairro('pq prado', 'Parque Prado');
runBairro('vila cristovaz', 'Vila Cristovam');
runBairro('vila crastina', 'Vila Cristina');

console.log('\n--- bairro com palavras de ruido ---');
runBairro('CHACARA ANTONIETA', 'CHACARA ANTONIETA');
runBairro('chacara antonieta', 'CHACARA ANTONIETA');
runBairro('Chácara Antonieta', 'CHACARA ANTONIETA');
runBairro('na chacara antonieta', 'CHACARA ANTONIETA');
runBairro('Na chavara antonieta', 'CHACARA ANTONIETA');
runBairro('chavara antonieta', 'CHACARA ANTONIETA');
runBairro('antonieta', 'CHACARA ANTONIETA');
runBairro('no centro', 'Centro');
runBairro('bairro centro', 'Centro');

console.log('\n--- tipo (tipoCombina) ---');
runTipo('Apartamento', 'apartamento', true);
runTipo('Apartamento', 'Apto', true);
runTipo('Apartamento', 'apartemento', true);
runTipo('Apartamento', 'um apartamento', true);
runTipo('Apartamento', 'quero um apartamento', true);
runTipo('Casa', 'casa', true);
runTipo('Apartamento', 'casa', false);

console.log('\n--- extrairNumero (inline) ---');
const NUMERO_EXTENSO: Record<string, number> = {
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4,
  cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
};
const extrairNumero = (texto: string | undefined): number | undefined => {
  if (!texto) return undefined;
  const limpo = texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const mil = limpo.replace(/\./g, '').match(/(\d+(?:,\d+)?)\s*mil\b/);
  if (mil) return Math.round(Number(mil[1].replace(',', '.')) * 1000);
  const match = limpo.replace(/\./g, '').match(/\d+/);
  if (match) return Number(match[0]);
  for (const [palavra, valor] of Object.entries(NUMERO_EXTENSO)) {
    if (new RegExp('\\b' + palavra + '\\b').test(limpo)) return valor;
  }
  return undefined;
};

function runNum(input: string, expected: number) {
  const got = extrairNumero(input);
  const ok = got === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'OK ' : 'FAIL'} extrairNumero(${JSON.stringify(input)}) = ${got} | esperado: ${expected}`);
}

runNum('3000', 3000);
runNum('3.000', 3000);
runNum('R$ 3000', 3000);
runNum('ate 3000', 3000);
runNum('3 mil', 3000);
runNum('3mil', 3000);
runNum('2,5 mil', 2500);
runNum('até 1.700 reais', 1700);
runNum('2', 2);
runNum('2 quartos', 2);
runNum('dois', 2);
runNum('três quartos', 3);
runNum('um', 1);

console.log('\n--- levenshtein direto ---');
console.log('lev(vila cristina, vila cristovam) =', levenshtein('vila cristina', 'vila cristovam'));
console.log('lev(pailo, paulo) =', levenshtein('pailo', 'paulo'));
console.log('lev(jardim sao pailo, jardim sao paulo) =', levenshtein('jardim sao pailo', 'jardim sao paulo'));

console.log('\n--- thresholds ---');
[3, 4, 5, 9, 10, 16].forEach((n) => console.log(`qLen=${n} threshold=${bairroThreshold(n)}`));

console.log(`\n${failed === 0 ? 'ALL PASS' : failed + ' FAILED'}`);
process.exit(failed === 0 ? 0 : 1);
