import { normalizarTelefone, normalizarNome } from '../src/imoveis/dado-cliente.controller';

let failed = 0;

function runTel(input: string, expected: string | null) {
  const got = normalizarTelefone(input);
  const ok = got === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'OK ' : 'FAIL'} normalizarTelefone(${JSON.stringify(input)}) = ${JSON.stringify(got)} | esperado: ${JSON.stringify(expected)}`);
}

function runNome(input: string, expected: string | null) {
  const got = normalizarNome(input);
  const ok = got === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'OK ' : 'FAIL'} normalizarNome(${JSON.stringify(input)}) = ${JSON.stringify(got)} | esperado: ${JSON.stringify(expected)}`);
}

console.log('--- telefone ---');
runTel('19 99999-8888', '5519999998888');
runTel('(19) 99999-8888', '5519999998888');
runTel('19999998888', '5519999998888');
runTel('5519999998888', '5519999998888');
runTel('+55 19 99999 8888', '5519999998888');
runTel('1938221234', '551938221234');
runTel('99999-8888', null);
runTel('19 89999-8888', null);
runTel('abc', null);
runTel('', null);

console.log('\n--- nome ---');
runNome('joão da silva', 'João da Silva');
runNome('MARIA DOS SANTOS', 'Maria dos Santos');
runNome('pedro alves', 'Pedro Alves');
runNome('a', null);
runNome('123', null);
runNome('', null);

console.log(`\n${failed === 0 ? 'ALL PASS' : failed + ' FAILED'}`);
process.exit(failed === 0 ? 0 : 1);
