# Protótipo: contas de investimento ligadas à conta principal (aguardando aprovação)

Ideia do usuário (2026-11-26): ao comprar um ativo, o valor vai automaticamente da conta corrente para uma
conta de investimento (a que o usuário cadastrou ou uma genérica, "pendurada" na conta principal). A conta de
investimento tem saldo próprio: dinheiro **disponível** + dinheiro **em ativos**.

- `1-contas.png`: card da conta principal com a conta de investimento embaixo, em letra menor, e a barra
  em ativos × disponível; resumo com Investido, Disponível p/ investir e Patrimônio.
- `2-investimentos.png`: topo do painel Investimentos com as contas de investimento.
- `3-compra-conta.png`: Nova compra "De uma conta corrente": mostra a transferência automática
  (Aplicação, fora de Despesas) e o preço médio antes/depois.
- `4-compra-disponivel.png`: Nova compra "Do disponível", com aviso e atalho quando o disponível não basta.
- `prototype.tsx`: código da prévia (dados fictícios).
