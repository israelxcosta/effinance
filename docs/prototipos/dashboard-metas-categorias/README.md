# Protótipo: Metas no Resumo do período e Gastos por categoria em barras (aguardando aprovação)

Pedido do usuário em 2026-11-26: trocar os cards de lugar no dashboard.

- `1-resumo-com-metas.png`: o terceiro bloco do "Resumo do período" passa a mostrar as **Metas** (até 3,
  com barra de progresso), no lugar do donut de gastos por categoria.
- `2-gastos-por-categoria-barras.png`: o card ao lado de "Próximos vencimentos" (onde ficavam as Metas)
  vira **Gastos por categoria** em **barras horizontais**, legenda à direita (cor, nome e %), valor em
  R$ ao passar o mouse (na imagem, sobre Alimentação). Até 8 categorias + "Outros"; clique abre as
  contas a pagar da categoria.
- `category-bars.tsx` e `dashboard.tsx.txt`: código do protótipo (dados reais da demo).
