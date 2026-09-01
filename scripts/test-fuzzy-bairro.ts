import { filtrarPorBairro, levenshtein, fuzzyContains, bairroThreshold } from '../src/imoveis/imoveis.service';

const cache = [
  { bairro: 'Jardim São Paulo', codigo: 1 },
  { bairro: 'Jardim Nova Europa', codigo: 2 },
  { bairro: 'Vila Cristovam', codigo: 3 },
  { bairro: 'Vila Cristina', codigo: 4 },
  { bairro: 'Cambuí', codigo: 5 },
  { bairro: 'Jd. Chapadão', codigo: 6 },
  { bairro: 'Parque Prado', codigo: 7 },
  { bairro: 'Centro', codigo: 8 },
];

function run(query: string, expected: string) {
  const res = filtrarPorBairro(cache, query);
  const bairros = res.map((r) => r.bairro).join(', ') || '(vazio)';
  const ok = expected === '*' ? true : bairros === expected;
  console.log(`${ok ? 'OK ' : 'FAIL'} bairro=${JSON.stringify(query)} → ${bairros} | esperado: ${expected}`);
}

console.log('--- casos do usuário ---');
run('jardim sao pailo', 'Jardim São Paulo');
run('jardim sao paulo', 'Jardim São Paulo');
run('vila cristovam', 'Vila Cristovam');
run('xyzabc123', '(vazio)');

console.log('\n--- extras ---');
run('vila cristina', 'Vila Cristina');
run('cambui', 'Cambuí');
run('cambuii', 'Cambuí');
run('centro', 'Centro');
run('jardin sao paulo', 'Jardim São Paulo');
run('jd sao paulo', 'Jardim São Paulo');
run('nova europa', 'Jardim Nova Europa');
run('chapadao', 'Jd. Chapadão');
run('pq prado', 'Parque Prado');

console.log('\n--- limites (garantir sem falso positivo) ---');
run('vila cristovaz', 'Vila Cristovam');
run('vila crastina', 'Vila Cristina');

console.log('\n--- prioridade exato > fuzzy ---');
run('vila cristina', 'Vila Cristina');
run('vila cristovam', 'Vila Cristovam');
run('cambui', 'Cambuí');

console.log('\n--- levenshtein direto ---');
console.log('lev(vila cristina, vila cristovam) =', levenshtein('vila cristina', 'vila cristovam'));
console.log('lev(pailo, paulo) =', levenshtein('pailo', 'paulo'));
console.log('lev(jardim sao pailo, jardim sao paulo) =', levenshtein('jardim sao pailo', 'jardim sao paulo'));

console.log('\n--- thresholds ---');
[3, 4, 5, 9, 10, 16].forEach((n) => console.log(`qLen=${n} threshold=${bairroThreshold(n)}`));
