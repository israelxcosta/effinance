# Protótipo: reserva de emergência acompanhada pelos investimentos (aguardando aprovação)

Pedido do usuário (2026-11-26): a reserva deve estar atrelada a um investimento (corretora, aplicação,
renda fixa), talvez contando a renda fixa aportada automaticamente.

Recomendação: a meta passa a **somar os ativos da carteira** marcados como reserva, em vez de aportes
próprios. Renda fixa entra automaticamente; cada ativo tem uma chave (ex.: tirar o Tesouro IPCA+ 2045,
que é de longo prazo). "Aplicar" abre a Nova compra já com Renda fixa, a corretora e "Pago com"
(Aplicação da conta corrente) e a chave "Contar na Reserva de emergência".

- `1-meta-card.png`: card da meta com o total vindo dos investimentos e os ativos que compõem.
- `2-meta-formulario.png`: "Acompanhar por Aportes | Investimentos", renda fixa automática e chaves por ativo.
- `3-aplicar.png`: Nova compra a partir da meta (Aplicação Itaú → XP; reserva antes → depois).
- `4-carteira.png`: carteira com o selo "Reserva" nos ativos que contam.
- `prototype.tsx`: código da prévia (dados fictícios).
