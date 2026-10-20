import type { CategoryType, IconName } from '@effinance/shared';

export interface DefaultCategory {
  name: string;
  type: CategoryType;
  icon: IconName;
  color: string;
  subcategories?: { name: string; icon: IconName }[];
}

/** Categories created for every new workspace. */
export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  {
    name: 'Alimentação',
    type: 'expense',
    icon: 'utensils',
    color: '#F97316',
    subcategories: [
      { name: 'Supermercado', icon: 'shopping-cart' },
      { name: 'Restaurantes', icon: 'utensils' },
      { name: 'Delivery', icon: 'pizza' },
      { name: 'Padaria e café', icon: 'coffee' },
    ],
  },
  {
    name: 'Moradia',
    type: 'expense',
    icon: 'house',
    color: '#152B61',
    subcategories: [
      { name: 'Aluguel', icon: 'house' },
      { name: 'Condomínio', icon: 'building-2' },
      { name: 'Energia', icon: 'lightbulb' },
      { name: 'Água', icon: 'droplet' },
      { name: 'Internet', icon: 'wifi' },
      { name: 'Manutenção', icon: 'wrench' },
    ],
  },
  {
    name: 'Transporte',
    type: 'expense',
    icon: 'car',
    color: '#3F64BE',
    subcategories: [
      { name: 'Combustível', icon: 'fuel' },
      { name: 'App de transporte', icon: 'car' },
      { name: 'Transporte público', icon: 'bus' },
      { name: 'Manutenção do veículo', icon: 'wrench' },
    ],
  },
  {
    name: 'Saúde',
    type: 'expense',
    icon: 'heart-pulse',
    color: '#E5484D',
    subcategories: [
      { name: 'Plano de saúde', icon: 'shield' },
      { name: 'Farmácia', icon: 'pill' },
      { name: 'Consultas e exames', icon: 'stethoscope' },
      { name: 'Academia', icon: 'dumbbell' },
    ],
  },
  {
    name: 'Educação',
    type: 'expense',
    icon: 'graduation-cap',
    color: '#7C3AED',
    subcategories: [
      { name: 'Cursos', icon: 'graduation-cap' },
      { name: 'Livros', icon: 'book-open' },
      { name: 'Mensalidade escolar', icon: 'graduation-cap' },
    ],
  },
  {
    name: 'Lazer',
    type: 'expense',
    icon: 'party-popper',
    color: '#EC4899',
    subcategories: [
      { name: 'Cinema e shows', icon: 'ticket' },
      { name: 'Viagens', icon: 'plane' },
      { name: 'Bares', icon: 'beer' },
      { name: 'Jogos', icon: 'gamepad-2' },
    ],
  },
  {
    name: 'Compras',
    type: 'expense',
    icon: 'shopping-bag',
    color: '#A855F7',
    subcategories: [
      { name: 'Roupas', icon: 'shirt' },
      { name: 'Eletrônicos', icon: 'smartphone' },
      { name: 'Casa e decoração', icon: 'house' },
      { name: 'Presentes', icon: 'gift' },
    ],
  },
  {
    name: 'Assinaturas',
    type: 'expense',
    icon: 'tv',
    color: '#0EA5E9',
    subcategories: [
      { name: 'Streaming', icon: 'film' },
      { name: 'Música', icon: 'music' },
      { name: 'Telefonia', icon: 'smartphone' },
      { name: 'Software', icon: 'laptop' },
    ],
  },
  {
    name: 'Impostos e taxas',
    type: 'expense',
    icon: 'receipt',
    color: '#64748B',
    subcategories: [
      { name: 'IPTU/IPVA', icon: 'receipt' },
      { name: 'Tarifas bancárias', icon: 'landmark' },
      { name: 'Imposto de renda', icon: 'receipt' },
    ],
  },
  {
    name: 'Pets',
    type: 'expense',
    icon: 'paw-print',
    color: '#EAB308',
    subcategories: [
      { name: 'Ração', icon: 'paw-print' },
      { name: 'Veterinário', icon: 'stethoscope' },
    ],
  },
  { name: 'Outras despesas', type: 'expense', icon: 'tag', color: '#78716C' },
  {
    name: 'Salário',
    type: 'income',
    icon: 'briefcase',
    color: '#12A150',
    subcategories: [
      { name: 'Salário mensal', icon: 'briefcase' },
      { name: '13º salário', icon: 'gift' },
      { name: 'Férias', icon: 'umbrella' },
      { name: 'Bônus/PLR', icon: 'star' },
    ],
  },
  {
    name: 'Freelance',
    type: 'income',
    icon: 'laptop',
    color: '#14B8A6',
    subcategories: [
      { name: 'Projetos', icon: 'laptop' },
      { name: 'Consultoria', icon: 'briefcase' },
    ],
  },
  {
    name: 'Rendimentos',
    type: 'income',
    icon: 'trending-up',
    color: '#0F766E',
    subcategories: [
      { name: 'Dividendos', icon: 'coins' },
      { name: 'Juros', icon: 'piggy-bank' },
    ],
  },
  { name: 'Aluguéis recebidos', type: 'income', icon: 'building-2', color: '#84CC16' },
  { name: 'Vendas', type: 'income', icon: 'store', color: '#F59E0B' },
  {
    name: 'Outras receitas',
    type: 'income',
    icon: 'coins',
    color: '#3F64BE',
    subcategories: [
      { name: 'Reembolsos', icon: 'hand-coins' },
      { name: 'Presentes recebidos', icon: 'gift' },
    ],
  },
];
