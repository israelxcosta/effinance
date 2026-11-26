# Protótipo: corretoras + aplicação automática na compra (aguardando aprovação)

Ideia do usuário (2026-11-26), substitui a prévia `investimentos-contas` (sem contas "penduradas"):
cadastro de **corretoras** com uma padrão "Carteira"; na compra, escolhe a corretora e a conta de onde
saiu o dinheiro ("Pago com"); o Effinance lança sozinho uma **Aplicação** (transferência) da conta para a
corretora, fora de Despesas. Em branco = o dinheiro já estava na corretora (só registra a compra).

- `1-investimentos.png`: painel com Total investido, Investido no mês, Ativos, Corretoras, "Por corretora"
  e a carteira com a coluna Corretora.
- `2-compra-corretoras.png`: Nova compra (Corretora + Pago com, resumo da aplicação, preço médio
  antes/depois) e o cadastro de Corretoras.
- `3-extrato.png`: a aplicação no extrato da conta corrente, com o selo "Aplicação".
- `prototype.tsx`: código da prévia (dados fictícios).
