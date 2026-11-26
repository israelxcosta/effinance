# Protótipo: relatório "Evolução por categoria" (aguardando aprovação)

Pedido do usuário em 2026-11-26: relatório de categorias × meses (receitas, despesas, média, total,
resultado), com design melhor que a referência e harmônico com o Effinance. **Ainda não implementado.**

- `claro.png` / `escuro.png`: capturas do protótipo rodando dentro do app (dados fictícios).
- `evolution-mock.tsx`: o componente do protótipo (dados fixos). Para revê-lo, copie para
  `apps/web/src/features/reports/components/` e adicione a aba `evolution` em `pages/reports.tsx`.

Proposta: aba **Evolução** em Relatórios; 4 cards de resumo; Mensal/Trimestral/Anual; período 6/12/24
meses; "% da receita"; Exportar; grupos Receitas/Despesas; subcategorias expansíveis; minigráfico por
linha; mapa de calor nas despesas; "—" no lugar de 0,00; mês atual "parcial"; Média e Total fixos à
direita; linha Resultado com "% guardado". Regras: vencimento e parceladas mês a mês.

Perguntas em aberto: valores das despesas neutros (vermelho só no subtotal/mapa de calor)? centavos ou
só reais? algo a tirar ou acrescentar?
