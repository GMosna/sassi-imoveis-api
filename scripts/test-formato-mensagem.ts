import { ImoveisController } from '../src/imoveis/imoveis.controller';

const ctrl = new ImoveisController({} as any);
const call = (nome: string, ...args: any[]) => (ctrl as any)[nome](...args);

const comCondominio = {
  codigo: 355, tipo: 'APARTAMENTO', bairro: 'CHACARA ANTONIETA',
  valor_locacao: 2000, valor_condominio: 450, dormitorios: 2, vagas_garagem: 1,
  metragem: 53, foto: 'https://sassiimoveis.com.br/x.jpg',
  link: 'https://sassiimoveis.com.br/imovel-aluguel/12486/apartamento-chacara-antonieta',
};

const semCondominio = { ...comCondominio, codigo: 500, valor_condominio: null };
const condZero = { ...comCondominio, codigo: 501, valor_condominio: 0 };
const semVagasSemMetragem = { ...comCondominio, codigo: 600, vagas_garagem: null, metragem: null };
const semDormitorios = { ...comCondominio, codigo: 700, dormitorios: null };

function show(label: string, im: any) {
  console.log(`\n=== ${label} ===`);
  const s = call('formatarMensagem', [im], false, false);
  console.log(s);
  const arr = call('formatarMensagens', [im], false, false);
  const iguais = arr.length === 1 && arr[0] === s;
  console.log(`\n[formatarMensagens[0] == formatarMensagem? ${iguais}]`);
}

show('com condominio (355)', comCondominio);
show('sem condominio null (500)', semCondominio);
show('condominio zero (501)', condZero);
show('sem vagas nem metragem (600)', semVagasSemMetragem);
show('sem dormitorios (700)', semDormitorios);

console.log('\n=== com fechamento ===');
console.log(call('formatarMensagem', [comCondominio], true, true));
