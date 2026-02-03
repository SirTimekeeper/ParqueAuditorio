# Parque Auditorio - Contagem de Viaturas

Web app para detetar e contar entradas/saídas de automóveis num parque, com processamento no browser (TensorFlow.js + COCO-SSD) e backend Node.js (Express) para servir a app e guardar configurações.

## Requisitos
- Node.js 18+ (recomendado)
- Navegador com suporte a `getUserMedia`

## Como correr

### Desenvolvimento
```bash
npm install
npm run dev
```
A app ficará disponível em `http://localhost:3000`.

> **Nota:** Em dispositivos móveis, a câmara pode exigir HTTPS. Use `localhost` no computador ou sirva via HTTPS num domínio local.

### Produção
```bash
npm install
npm run build
npm start
```

## Como dar permissões de câmara
- Ao abrir a página, o navegador irá pedir acesso à câmara.
- Se negar, o estado mostrará erro. Volte a permitir nas definições do navegador.

## Como desenhar linhas/zonas
1. Clique em **Definir Linha de Entrada** e desenhe a linha (clique/arraste).
2. Clique em **Definir Linha de Saída** e desenhe a linha.
3. (Opcional) Clique em **Definir Zona ROI** e desenhe um retângulo para filtrar deteções.

## Contagem e regras
- Um veículo conta quando o centro da bounding box cruza a linha.
- Se o movimento principal for **da esquerda para a direita**, o crossing é ignorado.
- Só conta 1 vez por track e por linha.
- Ocupação = Entradas - Saídas - Prioritárias (ajustes manuais).
- Ocupação nunca fica negativa.
- Limites: 112 lugares normais + 4 MR.

## Viaturas prioritárias
- UI simples para adicionar/remover IDs (ex: matrícula).
- O reconhecimento automático será adicionado mais tarde (TODO).

## Limitações
- Luz fraca, ângulo acentuado e reflexos podem reduzir a precisão.
- A deteção depende do modelo COCO-SSD e pode falhar em veículos muito pequenos ou parcialmente ocultos.
- Em dispositivos fracos, reduza resolução/frames por segundo.

## Estrutura do projeto
```
server/
  index.js
  storage.js
web/
  index.html
  styles.css
  app.js
  vision.js
  tracker.js
  counter.js
  config.js
  sw.js
scripts/
  build.js
```
