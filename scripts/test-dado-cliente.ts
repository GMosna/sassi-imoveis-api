import { normalizarTelefone, normalizarNome, normalizarEmail } from '../src/imoveis/dado-cliente.controller';

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

function runEmail(input: string, expected: string | null) {
  const got = normalizarEmail(input);
  const ok = got === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'OK ' : 'FAIL'} normalizarEmail(${JSON.stringify(input)}) = ${JSON.stringify(got)} | esperado: ${JSON.stringify(expected)}`);
}

console.log('--- telefone (celular 5519997780680) ---');
runTel('19997780680', '5519997780680');
runTel('19 997780680', '5519997780680');
runTel('19 99778-0680', '5519997780680');
runTel('(19) 99778-0680', '5519997780680');
runTel('(19)99778-0680', '5519997780680');
runTel('19.99778.0680', '5519997780680');
runTel('19/99778/0680', '5519997780680');
runTel('+55 19 99778-0680', '5519997780680');
runTel('+5519997780680', '5519997780680');
runTel('55 (19) 99778-0680', '5519997780680');
runTel('0 19 99778 0680', '5519997780680');
runTel('meu whats é 19 99778-0680', '5519997780680');
runTel('pode chamar no (19) 99778-0680 obrigado', '5519997780680');
runTel('é 19997780680 mesmo', '5519997780680');

console.log('\n--- telefone fixo (551938221234) ---');
runTel('1938221234', '551938221234');
runTel('(19) 3822-1234', '551938221234');

console.log('\n--- telefone invalidos ---');
runTel('99778-0680', null);
runTel('19 89778-0680', null);
runTel('123', null);
runTel('abc', null);
runTel('', null);

console.log('\n--- email ---');
runEmail('joao@gmail.com', 'joao@gmail.com');
runEmail('JOAO@GMAIL.COM', 'joao@gmail.com');
runEmail('joao.silva@empresa.com.br', 'joao.silva@empresa.com.br');
runEmail('meu email é joao@gmail.com', 'joao@gmail.com');
runEmail('pode mandar pra joao@gmail.com.', 'joao@gmail.com');
runEmail('joao+teste@gmail.com', 'joao+teste@gmail.com');
runEmail('joao', null);
runEmail('joao@', null);
runEmail('@gmail.com', null);
runEmail('', null);

console.log('\n--- nome (regressao) ---');
runNome('joão da silva', 'João da Silva');
runNome('MARIA DOS SANTOS', 'Maria dos Santos');
runNome('a', null);

console.log(`\n${failed === 0 ? 'ALL PASS' : failed + ' FAILED'}`);
process.exit(failed === 0 ? 0 : 1);
