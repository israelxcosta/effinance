# Protótipo: venda com resultado e proventos (implementado em 2026-11-26)

Pedido do usuário (2026-11-26): vender com preço de venda (pode dar prejuízo) e lançar proventos
(dividendos, JCP, juros, rendimento); o dinheiro fica na corretora e pode ser transferido para a conta
corrente ou aplicado de novo.

Regra proposta: resultado da venda = valor da venda − taxas − quantidade × preço médio (o preço médio
não muda). O valor fica na conta da corretora; o lucro entra como receita e o prejuízo como despesa
(categoria de investimentos), de modo que o saldo da corretora = custo dos ativos + dinheiro
disponível. Proventos entram como receita na conta da corretora. "Disponível nas corretoras" =
saldo da conta − custo dos ativos; Transferir (Resgate) ou Aplicar (compra com "Já estava na corretora").

- `1-vender.png`, `2-provento.png`, `3-pagina.png`; `prototype.tsx` (dados fictícios).
