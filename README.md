# Sassi Imóveis - API de Busca (Locação)

Serviço somente leitura que consulta a view de imóveis disponíveis para
locação e devolve os resultados em JSON, pra ser consumido pela
"Habilidade" do agente de IA no RD Station Conversas.

## Importante: hospedagem mudou

O banco de dados fica num IP de rede local (`192.168.0.254`), só acessível de
dentro da rede da Sassi. Isso significa que **não dá pra hospedar esse
serviço no Railway/Render/Fly.io** como planejado inicialmente — nuvem
pública não alcança IP de rede local.

Este serviço precisa rodar numa máquina dentro do escritório da Sassi,
sempre ligada (pode ser um desktop ou um mini PC dedicado). Como o RD
Station Conversas está na nuvem e precisa conseguir chamar esse serviço
pela internet, a forma mais simples e segura de expor só esse serviço
(sem abrir porta no roteador nem expor o banco) é um **Cloudflare
Tunnel** — gratuito, dá uma URL pública `https://...` que aponta pro
serviço rodando localmente. Isso é um passo separado, pra configurar
depois de validar a conexão com o banco.

## Modo mock — testar hoje, sem esperar o banco

Esse serviço tem um modo de dados fictícios, pra você já poder subir,
testar e até configurar a Habilidade no RD Conversas antes do acesso ao
banco chegar. Com `USE_MOCK_DATA=true` no `.env`, o endpoint responde
com 3 imóveis de exemplo (filtráveis por bairro, tipo, dormitórios e
valor), sem precisar de nenhuma credencial de banco.

Quando o Reginaldo liberar o acesso, é só trocar `USE_MOCK_DATA=true`
para `false` (ou apagar a linha) e preencher os campos `DB_*` — nenhuma
outra parte do código muda, e a Habilidade já configurada no RD continua
apontando pra mesma URL.

## O que falta pra rodar

1. **Instalar as dependências:**
   ```
   npm install
   ```

2. **Preencher o `.env`:**
   Copie `.env.example` para `.env`. Pra testar agora, deixe
   `USE_MOCK_DATA=true` e gere só o `API_TOKEN` (ex:
   `openssl rand -hex 32`) — não precisa preencher os campos `DB_*`
   ainda. Quando o Reginaldo liberar o acesso, preencha host, porta,
   nome do banco, usuário, senha e o nome exato da view
   (`DB_VIEW_NAME`), e mude `USE_MOCK_DATA` para `false`.

3. **Ajustar os nomes de coluna:**
   O arquivo `src/imoveis/imoveis.service.ts` usa nomes de coluna
   "chute" (codigo, tipo, bairro, dormitorios, valor_locacao, etc.).
   Assim que o Reginaldo confirmar os nomes reais das colunas na view,
   ajuste o SELECT nesse arquivo pra bater exatamente.

4. **Rodar localmente pra testar:**
   ```
   npm run start:dev
   ```
   Depois teste com:
   ```
   curl "http://localhost:3000/imoveis-disponiveis?bairro=Cambui&dormitorios=2" \
     -H "Authorization: Bearer SEU_TOKEN_AQUI"
   ```

5. **Hospedar:** ver a seção "Importante: hospedagem mudou" no topo
   deste README — este serviço precisa rodar numa máquina dentro da rede
   da Sassi, exposto à internet via Cloudflare Tunnel (não em nuvem
   pública como Railway/Render, porque o banco só é acessível
   localmente).

## Segurança

- O endpoint exige o header `Authorization: Bearer <token>` em toda
  chamada — sem token correto, ele responde 401 e não consulta o banco.
- O usuário do banco deve ter permissão **somente leitura** e, se
  possível, restrita só a essa view — nunca use um usuário com acesso
  de escrita ou às tabelas completas.
- Nunca commite o arquivo `.env` real no git (o `.gitignore` já cobre
  isso, mas vale checar).

## Próximo passo depois que isso estiver no ar

Cadastrar essa URL como uma "Habilidade" no agente de Locação do RD
Station Conversas, apontando para:
```
GET https://<sua-url>/imoveis-disponiveis?bairro=&tipo=&dormitorios=&valor_max=
Header: Authorization: Bearer <API_TOKEN>
```
